const fs = require('fs');
const utils = require('./utils');

function ensureDirectoryExists(week) {
    !fs.existsSync(`./reports/${week}/`) && fs.mkdirSync(`./reports/${week}/`);
}

function pricesAvailable(week) {
    return fs.existsSync(`./reports/${week}/_prices.json`);
}

function readPrices(week) {
    const jsonString = fs.readFileSync(`./reports/${week}/_prices.json`);
    return JSON.parse(jsonString);
}

function writePrices(week, prices) {
    let path = `/${week}/_prices`;
    utils.writeData(prices, path);
}

function writeBlockRewards(week, blockNum, blockRewards) {
    let path = `/${week}/${blockNum}`;
    utils.writeData(blockRewards, path);
}

function writePools(week, pools) {
    utils.writeData(pools, `/${week}/_pools`);
}

module.exports = {
    ensureDirectoryExists,
    pricesAvailable,
    readPrices,
    writePrices,
    writePools,
    writeBlockRewards,
};
