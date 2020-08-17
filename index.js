const Web3 = require('web3');
const cliProgress = require('cli-progress');
const { argv } = require('yargs');

const utils = require('./lib/utils');
const poolAbi = require('./abi/BPool.json');
const tokenAbi = require('./abi/BToken.json');

const { getRewardsAtBlock } = require('./lib/blockData');
const { REP_TOKEN, REP_TOKEN_V2 } = require('./lib/tokens');
const {
    ensureDirectoryExists,
    pricesAvailable,
    readPrices,
    writePrices,
    writePools,
    writeBlockRewards,
} = require('./lib/fileService');
const { bnum } = require('./lib/utils');

const ENDPOINT = process.env.ENDPOINT_URL;
//const ENDPOINT = "ws://localhost:8546"

const web3 = new Web3(new Web3.providers.WebsocketProvider(ENDPOINT));

if (!argv.startBlock || !argv.endBlock || !argv.week) {
    console.log(
        'Usage: node index.js --week 1 --startBlock 10131642 --endBlock 10156690'
    );
    process.exit();
}

const END_BLOCK = argv.endBlock; // Closest block to reference time at end of week
const START_BLOCK = argv.startBlock; // Closest block to reference time at beginning of week
const WEEK = argv.week; // Week for mining distributions. Ex: 1

const BAL_PER_WEEK = bnum(145000);
const BLOCKS_PER_SNAPSHOT = 256;
const BAL_PER_SNAPSHOT = BAL_PER_WEEK.div(
    bnum(Math.ceil((END_BLOCK - START_BLOCK) / BLOCKS_PER_SNAPSHOT))
); // Ceiling because it includes end block

(async function () {
    const multibar = new cliProgress.MultiBar(
        {
            clearOnComplete: false,
            format:
                '[{bar}] {percentage}% | ETA: {eta}s | {value}/{total} | {task}',
        },
        cliProgress.Presets.shades_classic
    );

    ensureDirectoryExists(WEEK);

    let startBlockTimestamp = (await web3.eth.getBlock(START_BLOCK)).timestamp;
    let endBlockTimestamp = (await web3.eth.getBlock(END_BLOCK)).timestamp;

    let pools = await utils.fetchAllPools(END_BLOCK);
    writePools(WEEK, pools);

    let prices = {};

    if (pricesAvailable(WEEK)) {
        prices = readPrices(WEEK);
    } else {
        const whitelist = await utils.fetchWhitelist();

        let priceProgress = multibar.create(whitelist.length, 0, {
            task: 'Fetching Prices',
        });

        prices = await utils.fetchTokenPrices(
            whitelist,
            startBlockTimestamp,
            endBlockTimestamp,
            priceProgress
        );

        prices[REP_TOKEN] = prices[REP_TOKEN_V2];

        writePrices(WEEK, prices);
    }

    const poolProgress = multibar.create(pools.length * 2, 0, {
        task: 'Block Progress',
    });
    const blockProgress = multibar.create(END_BLOCK - START_BLOCK, 0, {
        task: 'Overall Progress',
    });

    for (i = END_BLOCK; i > START_BLOCK; i -= BLOCKS_PER_SNAPSHOT) {
        if (argv.skipBlock && i >= argv.skipBlock) {
            blockProgress.increment(BLOCKS_PER_SNAPSHOT);
            continue;
        }

        let blockRewards = await getRewardsAtBlock(
            web3,
            i,
            BAL_PER_SNAPSHOT,
            pools,
            prices,
            poolProgress
        );
        writeBlockRewards(WEEK, i, blockRewards);
        blockProgress.increment(BLOCKS_PER_SNAPSHOT);
    }

    blockProgress.stop();
})();
