const poolAbi = require('../abi/BPool.json');
const tokenAbi = require('../abi/BToken.json');
const { bnum, scale } = require('./utils');
import { uncappedTokens } from './tokens';
const BigNumber = require('bignumber.js');

const MARKETCAP_CAP = bnum(10000000);

const {
    getFeeFactor,
    getBalFactor,
    getRatioFactor,
    getWrapFactor,
} = require('./factors');

BigNumber.config({
    EXPONENTIAL_AT: [-100, 100],
    ROUNDING_MODE: BigNumber.ROUND_DOWN,
    DECIMAL_PLACES: 18,
});

interface PoolData {
    poolAddress?: string | undefined;
    tokens?: any[];
    marketCap?: number;
    eligibleTotalWeight?: number;
    ratioFactor?: number;
    wrapFactor?: number;
    feeFactor?: number;
    originalPoolMarketCapFactor?: number;
    shareHolders?: any[];
    controller?: string;
}

async function getPoolData(web3, prices, block, pool) {
    let poolData: PoolData = {
        poolAddress: pool.id,
    };

    // Check if at least two tokens have a price
    let atLeastTwoTokensHavePrice = false;
    let nTokensHavePrice = 0;

    if (pool.createTime > block.timestamp || !pool.tokensList) {
        return { notCreatedByBlock: true };
    }

    let bPool = new web3.eth.Contract(poolAbi, poolData.poolAddress);

    let publicSwap = await bPool.methods
        .isPublicSwap()
        .call(undefined, block.number);
    if (!publicSwap) {
        return { privatePool: true };
    }

    let currentTokens = await bPool.methods
        .getCurrentTokens()
        .call(undefined, block.number);

    for (const t of currentTokens) {
        let token = web3.utils.toChecksumAddress(t);
        if (prices[token] !== undefined && prices[token].length > 0) {
            nTokensHavePrice++;
            if (nTokensHavePrice > 1) {
                atLeastTwoTokensHavePrice = true;
                break;
            }
        }
    }

    if (!atLeastTwoTokensHavePrice) {
        return { unpriceable: true };
    }

    let poolMarketCap = bnum(0);
    let originalPoolMarketCapFactor = bnum(0);
    let eligibleTotalWeight = bnum(0);
    let poolRatios: any[] = [];

    for (const t of currentTokens) {
        // Skip token if it doesn't have a price
        let token = web3.utils.toChecksumAddress(t);
        if (prices[token] === undefined || prices[token].length === 0) {
            continue;
        }
        let bToken = new web3.eth.Contract(tokenAbi, token);
        let tokenBalanceWei = await bPool.methods
            .getBalance(token)
            .call(undefined, block.number);
        let tokenDecimals = await bToken.methods.decimals().call();
        let normWeight = await bPool.methods
            .getNormalizedWeight(token)
            .call(undefined, block.number);

        eligibleTotalWeight = eligibleTotalWeight.plus(scale(normWeight, -18));

        let closestPrice = prices[token].reduce((a, b) => {
            return Math.abs(b[0] - block.timestamp * 1000) <
                Math.abs(a[0] - block.timestamp * 1000)
                ? b
                : a;
        })[1];

        let tokenBalance = scale(tokenBalanceWei, -tokenDecimals);
        let tokenMarketCap = tokenBalance.times(bnum(closestPrice)).dp(18);

        if (poolData.tokens) {
            let obj = {
                token: t,
                origMarketCap: tokenMarketCap,
                normWeight: scale(normWeight, -18),
            };
            poolData.tokens.push(obj);
        } else {
            poolData.tokens = [
                {
                    token: t,
                    origMarketCap: tokenMarketCap,
                    normWeight: scale(normWeight, -18),
                },
            ];
        }

        const scaledPoolRatio = scale(normWeight, -18);
        poolRatios.push(scaledPoolRatio);
        poolMarketCap = poolMarketCap.plus(tokenMarketCap);
    }

    poolData.marketCap = poolMarketCap;
    poolData.eligibleTotalWeight = eligibleTotalWeight;

    let ratioFactor = getRatioFactor(currentTokens, poolRatios);
    let wrapFactor = getWrapFactor(currentTokens, poolRatios);

    let poolFee = await bPool.methods
        .getSwapFee()
        .call(undefined, block.number);
    poolFee = scale(poolFee, -16); // -16 = -18 * 100 since it's in percentage terms
    let feeFactor = bnum(getFeeFactor(poolFee));

    originalPoolMarketCapFactor = feeFactor
        .times(ratioFactor)
        .times(wrapFactor)
        .times(poolMarketCap)
        .dp(18);

    poolData.ratioFactor = ratioFactor;
    poolData.wrapFactor = wrapFactor;
    poolData.feeFactor = feeFactor;
    poolData.originalPoolMarketCapFactor = originalPoolMarketCapFactor;

    poolData.shareHolders = pool.shareHolders;
    poolData.controller = pool.controller;

    return poolData;
}

function addMarketCaps(tokenTotalMarketCaps, poolData) {
    const {
        tokens,
        eligibleTotalWeight,
        originalPoolMarketCapFactor,
    } = poolData;
    for (const r of tokens) {
        //let r = tokens[t];
        let tokenMarketCapWithCap = r.normWeight
            .div(eligibleTotalWeight)
            .times(originalPoolMarketCapFactor);

        if (tokenTotalMarketCaps[r.token]) {
            tokenTotalMarketCaps[r.token] = bnum(
                tokenTotalMarketCaps[r.token]
            ).plus(tokenMarketCapWithCap);
        } else {
            tokenTotalMarketCaps[r.token] = tokenMarketCapWithCap;
        }
    }
    return tokenTotalMarketCaps;
}

function poolMarketCap(tokenTotalMarketCaps, tokens) {
    return tokens.reduce((aggregateAdjustedMarketCap, t) => {
        let adjustedTokenMarketCap;
        const shouldAdjustMarketCap =
            !uncappedTokens.includes(t.token) &&
            bnum(tokenTotalMarketCaps[t.token] || 0).isGreaterThan(
                MARKETCAP_CAP
            );

        if (shouldAdjustMarketCap) {
            let tokenMarketCapFactor = MARKETCAP_CAP.div(
                tokenTotalMarketCaps[t.token]
            );
            adjustedTokenMarketCap = t.origMarketCap
                .times(tokenMarketCapFactor)
                .dp(18);
        } else {
            adjustedTokenMarketCap = t.origMarketCap;
        }
        return aggregateAdjustedMarketCap.plus(adjustedTokenMarketCap);
    }, bnum(0));
}

module.exports = { getPoolData, addMarketCaps, poolMarketCap };
