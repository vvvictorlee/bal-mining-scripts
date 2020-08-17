const {
    getPoolData,
    addMarketCaps,
    poolMarketCap,
    PoolData,
} = require('./poolData');
const { scale } = require('./utils');
const poolAbi = require('../abi/BPool.json');

async function getRewardsAtBlock(
    web3,
    blockNum,
    bal_per_snapshot,
    pools,
    prices,
    poolProgress
) {
    let totalBalancerLiquidity = bnum(0);

    let block = await web3.eth.getBlock(blockNum);

    let allPoolData: typeof PoolData[] = [];
    let userPools = {};
    let userLiquidity = {};
    let tokenTotalMarketCaps = {};

    poolProgress.update(0, { task: `Block ${blockNum} Progress` });

    for (const pool of pools) {
        const poolData = await getPoolData(web3, prices, block, pool);
        poolProgress.increment(1);
        if (
            poolData.privatePool ||
            poolData.unpriceable ||
            poolData.notCreatedByBlock
        ) {
            continue;
        }

        allPoolData.push(poolData);
        tokenTotalMarketCaps = addMarketCaps(tokenTotalMarketCaps, poolData);
    }
    // Adjust pool market caps
    for (const pool of allPoolData) {
        const finalPoolMarketCap = poolMarketCap(
            tokenTotalMarketCaps,
            pool.tokens
        );
        const finalPoolMarketCapFactor = pool.feeFactor
            .times(pool.ratioFactor)
            .times(pool.wrapFactor)
            .times(finalPoolMarketCap)
            .dp(18);

        totalBalancerLiquidity = totalBalancerLiquidity.plus(
            finalPoolMarketCapFactor
        );

        let bPool = new web3.eth.Contract(poolAbi, pool.poolAddress);

        let bptSupplyWei = await bPool.methods
            .totalSupply()
            .call(undefined, blockNum);
        let bptSupply = scale(bptSupplyWei, -18);

        const isPrivatePool = bptSupply.eq(bnum(0));

        if (isPrivatePool) {
            // Private pool
            const privatePool = {
                pool: pool.poolAddress,
                feeFactor: pool.feeFactor.toString(),
                ratioFactor: pool.ratioFactor.toString(),
                wrapFactor: pool.wrapFactor.toString(),
                valueUSD: finalPoolMarketCap.toString(),
                factorUSD: finalPoolMarketCapFactor.toString(),
            };

            if (userPools[pool.controller]) {
                userPools[pool.controller].push(privatePool);
            } else {
                userPools[pool.controller] = [privatePool];
            }

            // Add this pool liquidity to total user liquidity
            if (userLiquidity[pool.controller]) {
                userLiquidity[pool.controller] = bnum(
                    userLiquidity[pool.controller]
                )
                    .plus(finalPoolMarketCapFactor)
                    .toString();
            } else {
                userLiquidity[
                    pool.controller
                ] = finalPoolMarketCapFactor.toString();
            }
        } else {
            // Shared pool
            for (const holder of pool.shareHolders) {
                let userBalanceWei = await bPool.methods
                    .balanceOf(holder)
                    .call(undefined, blockNum);
                let userBalance = scale(userBalanceWei, -18);
                let userPoolValue = userBalance
                    .div(bptSupply)
                    .times(finalPoolMarketCap)
                    .dp(18);

                let userPoolValueFactor = userBalance
                    .div(bptSupply)
                    .times(finalPoolMarketCapFactor)
                    .dp(18);

                let sharedPool = {
                    pool: pool.poolAddress,
                    feeFactor: pool.feeFactor.toString(),
                    ratioFactor: pool.ratioFactor.toString(),
                    wrapFactor: pool.wrapFactor.toString(),
                    valueUSD: userPoolValue.toString(),
                    factorUSD: userPoolValueFactor.toString(),
                };
                if (userPools[holder]) {
                    userPools[holder].push(sharedPool);
                } else {
                    userPools[holder] = [sharedPool];
                }

                // Add this pool liquidity to total user liquidity
                if (userLiquidity[holder]) {
                    userLiquidity[holder] = bnum(userLiquidity[holder])
                        .plus(userPoolValueFactor)
                        .toString();
                } else {
                    userLiquidity[holder] = userPoolValueFactor.toString();
                }
            }
        }

        poolProgress.increment(1);
    }

    // Final iteration across all users to calculate their BAL tokens for this block
    let userBalReceived = {};
    for (const user in userLiquidity) {
        userBalReceived[user] = bnum(userLiquidity[user])
            .times(bal_per_snapshot)
            .div(totalBalancerLiquidity);
    }

    return [userPools, userBalReceived, tokenTotalMarketCaps];
}

module.exports = { getRewardsAtBlock };
