require('dotenv').config();
import fs from 'fs';
const cliProgress = require('cli-progress');
const fetch = require('isomorphic-fetch');
const BigNumber = require('bignumber.js');
const Web3 = require('web3');

const ENDPOINT = process.env.ENDPOINT_URL;
//const ENDPOINT = "ws://localhost:8546"

const web3 = new Web3(new Web3.providers.WebsocketProvider(ENDPOINT));

BigNumber.config({
    EXPONENTIAL_AT: [-100, 100],
    ROUNDING_MODE: BigNumber.ROUND_DOWN,
    DECIMAL_PLACES: 18,
});

function bnum(val) {
    return new BigNumber(val.toString());
}

const SUBGRAPH_URL =
    process.env.SUBGRAPH_URL ||
    'https://api.thegraph.com/subgraphs/name/balancer-labs/balancer';
const MARKET_API_URL =
    process.env.MARKET_API_URL || 'https://api.coingecko.com/api/v3';

const scale = (input, decimalPlaces) => {
    const scalePow = new BigNumber(decimalPlaces);
    const scaleMul = new BigNumber(10).pow(scalePow);
    return new BigNumber(input).times(scaleMul);
};

const writeData = (data, path) => {
    try {
        fs.writeFileSync(
            `./reports/${path}.json`,
            JSON.stringify(data, null, 4)
        );
    } catch (err) {
        console.error(err);
    }
};

interface User {
    id: string;
}

interface Share {
    userAddress: User;
}

interface PoolResult {
    shareHolders?: any[];
    shares: Share[];
    id?: string;
}

async function fetchAllPools(block) {
    let poolResults: PoolResult[] = [];
    let skip = 0;
    let paginatePools = true;
    while (paginatePools) {
        let query = `
            {
                pools (first: 1000, skip: ${skip}, block: { number: ${block} }) {
                    id
                    publicSwap
                    swapFee
                    controller
                    createTime
                    tokensList
                    totalShares
                    shares (first: 1000) {
                        userAddress {
                            id
                        }
                    }
                }
            }
        `;

        let response = await fetch(SUBGRAPH_URL, {
            method: 'POST',
            headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                query,
            }),
        });

        let { data } = await response.json();

        poolResults = poolResults.concat(data.pools);

        if (data.pools.length < 1000) {
            paginatePools = false;
        } else {
            skip += 1000;
            continue;
        }
    }

    let finalResults: PoolResult[] = [];

    for (let pool of poolResults) {
        pool.shareHolders = pool.shares.map((a) => a.userAddress.id);
        if (pool.shareHolders.length == 1000) {
            let paginateShares = true;
            let shareSkip = 0;
            let shareResults = [];

            while (paginateShares) {
                let query = `
                    {
                        pools (where: { id: "${pool.id}"}, block: { number: ${block} }) {
                            shares (first: 1000, skip: ${shareSkip}) {
                                userAddress {
                                    id
                                }
                            }
                        }
                    }
                `;

                let response = await fetch(SUBGRAPH_URL, {
                    method: 'POST',
                    headers: {
                        Accept: 'application/json',
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        query,
                    }),
                });

                let { data } = await response.json();

                let newShareHolders = data.pools[0].shares.map(
                    (a) => a.userAddress.id
                );

                shareResults = shareResults.concat(newShareHolders);

                if (newShareHolders.length < 1000) {
                    paginateShares = false;
                } else {
                    shareSkip += 1000;
                    continue;
                }
            }

            pool.shareHolders = shareResults;
            delete pool.shares;

            finalResults.push(pool);
        } else {
            delete pool.shares;
            finalResults.push(pool);
        }
    }

    return finalResults;
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWhitelist() {
    const response = await fetch(
        `https://raw.githubusercontent.com/balancer-labs/assets/master/lists/eligible.json`,
        {
            headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json',
            },
        }
    );

    let whitelistResponse = await response.json();
    return whitelistResponse.homestead;
}

async function fetchTokenPrices(allTokens, startTime, endTime, priceProgress) {
    let prices = {};

    for (let tokenAddress of allTokens) {
        const address = tokenAddress
            ? web3.utils.toChecksumAddress(tokenAddress)
            : null;
        const query = `coins/ethereum/contract/${address}/market_chart/range?&vs_currency=usd&from=${startTime}&to=${endTime}`;

        const response = await fetch(`${MARKET_API_URL}/${query}`, {
            headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json',
            },
        });

        let priceResponse = await response.json();
        prices[address] = priceResponse.prices;
        priceProgress.increment();
        // Sleep between requests to prevent rate-limiting
        await sleep(1000);
    }
    priceProgress.stop();

    return prices;
}

module.exports = {
    bnum,
    scale,
    writeData,
    fetchAllPools,
    fetchWhitelist,
    fetchTokenPrices,
};
