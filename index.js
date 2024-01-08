/**
 * QuarryDraw avalanche price feeds Oracle
 */

/**
 * Setup packages
 */
require('dotenv').config();

const axios = require('axios').default;

const { ethers } = require("ethers");

/**
 * Setup environment variables
 */
const ABI = [
    "function updateOracleFeed(address _token, uint256 _value) external returns(bool)",

    "function getTokenInfo(address _token) public view returns((address ownerToken, uint256 pricePerToken, uint256 avaxDeposited, uint240 avaxIncentives, uint16 rebatePercentageInBPS, bool fungible, string collectionName))",
    "function expiredOracle(address _token) public view returns(bool)",
    "function getFacetPaused() public view returns(bool)",
    "function getAllApprovedTokens() public view returns(address[] memory)",
    "function getTokenPeriodAndLastTimestampUpdate(address _token) public view returns(uint256, uint256)",
    "function isOracleAllowed(address _oracle) public view returns(bool)",
    "function getNotInitialized(address _token) public view returns(bool)",

    "event Token(bool indexed created, address indexed token)",
    "event TokenManaged(address indexed token, uint256 indexed price, uint256 oracleTimestamp, bool _fungible, string data)"

];
const address = process.env.CONTRACT_ADDRESS;
let feeds = [
    // {
    //     address: "",

    //     timestamp: 0,
    //     intervalSetted: false,
    //     intervalId: 0,

    //     fungible: true,

    //     collectionName: "thor-V2"
    // }
]
const baseURL = process.env.BASE_URL;

const provider = new ethers.providers.JsonRpcProvider(process.env.RPC);
const walletWithProvider = new ethers.Wallet(process.env.ORACLE_WALLET_PRIVATE_KEY, provider);
const Contract = new ethers.Contract(address, ABI, provider);
const contract = Contract.connect(walletWithProvider);

if (provider != undefined) console.log('\nProvider defined');
if (contract != undefined) console.log('\nContract defined and connected to oracle\'s wallet');

/**
 * Function used to initialize and bring up to date the oracle.
 * 1. it fetches to all approved tokens and updates their values
 * 2. If a token needs a feeds it looks if it needs to be updated,
 * if it does need it update gets send
 * 3. Activates interval for interested feeds.
 */
async function init() {
    console.log("\nInitializing oracle");

    let tokens = (await contract.getAllApprovedTokens());

    for (const e of tokens) {
        console.log("\nNew token initializated: " + e);

        let tokenInfo = (await contract.getTokenInfo(e));
        let notInitialized = (await contract.getNotInitialized(e)).toString();

        let pricePerToken = Number(tokenInfo.pricePerToken.toString());
        let fungible = tokenInfo.fungible;
        let collectionName = tokenInfo.collectionName;

        let tokenInstance = {
            address: e,
            oldPrice: undefined,

            timestamp: undefined,
            intervalSetted: false,
            intervalId: undefined,

            fungible: undefined,

            collectionName: undefined
        }

        if (pricePerToken == 0 && notInitialized == 'false') {
            console.log('\nUpdating values for: ' + tokenInstance.address);

            tokenInstance.collectionName = collectionName;
            console.log('New collection name: ' + tokenInstance.collectionName);

            tokenInstance.fungible = fungible;
            console.log('New fungible status: ' + tokenInstance.fungible);

            feeds.push(tokenInstance);
            await oracle(e);

            let currentTimestamp = Number((await provider.getBlock(await provider.getBlockNumber())).timestamp);
            let times = (await contract.getTokenPeriodAndLastTimestampUpdate(e));
            let tokenPeriod = Number(times[0].toString());
            let lastTimestampUpdate = Number(times[1].toString());

            let timeFromUpdate = currentTimestamp - lastTimestampUpdate;

            let timeout = tokenPeriod - timeFromUpdate;

            if (timeout < 0) {
                timeout = 0;
            }

            setTimeout(addInitInterval, timeout * 1000, e, tokenPeriod);
            console.log('\nInitialization completed for: ' + e);
            console.log('\nAdding interval in: ' + timeout + ' seconds');
        } else {
            feeds.push(tokenInstance);
            console.log('\nNo changes needed for: ' + e);
        }
    }

    console.log('\nOracle init completed');
}

async function addInitInterval(tokenAddress, intervalPeriod) {
    console.log('\nTimeout started for: ' + tokenAddress);

    let values;

    for (const i of feeds) {
        if (i.address == tokenAddress) {
            values = i;
        }
    }
    if (values == undefined) {
        console.log('\nToken doesnt exist anymore.');
        return;
    }

    if (values.intervalSetted == true && values.intervalId != undefined) {
        console.log('\nTimeout frontrunned for: ' + values.address);
        return;
    }

    let tokenInfo = (await contract.getTokenInfo(tokenAddress));
    let pricePerToken = Number(tokenInfo.pricePerToken.toString());
    if (pricePerToken != 0) {
        console.log('\nPrice feed frontrunned for: ' + values.address);
        return;
    }

    await oracle(values.address);

    values.timestamp = intervalPeriod;

    values.intervalId = setInterval(oracle, (values.timestamp * 1000) + 300_000, values.address); // 5 min delay
    values.intervalSetted = true;

    console.log('New ' + (values.timestamp * 1000 + 300_000) / 1000 + ' seconds interval to: ' + values.collectionName);
}

async function main() {
    await init();
}
main();

console.log('\nOracle Live fetching at address: ' + address);

/**
 * Oracle function, takes address of token, verify ability to update feeds and updates it
 */
async function oracle(tokenAddress) {
    // Check if oracle is allowed
    let allowed = (await contract.isOracleAllowed(walletWithProvider.address)).toString();
    if (allowed == 'false') {
        console.log("\nOracle address is not  allowed : " + walletWithProvider.address);
        return;
    }

    let values
    for (const i of feeds) {
        if (i.address == tokenAddress) {
            values = i;
        }
    }
    if (values == undefined) {
        console.log('\nToken doesnt exist anymore.');
        return;
    }

    console.log("\nOracle started for: " + values.collectionName);

    // Be sure facet is not paused
    let paused = (await contract.getFacetPaused()).toString();
    if (paused == 'true') {
        console.log('Facet is paused');
        return;
    }

    // Check expiry
    let expiry = (await contract.expiredOracle(tokenAddress)).toString();
    if (expiry == 'false') {
        console.log('Data cant be updated for: ' + values.collectionName);
        return;
    }

    // Add filter price: getTokenMargin
    let margin = Number((await contract.getTokenInfo(tokenAddress)).avaxDeposited.toString());
    let price = values.oldPrice * 1e18
    if (values.oldPrice != undefined && values.fungible && margin / 1e17 <= 1) {
        console.log('Not enough margin to update it : ' + values.collectionName);
        return;
    } else if (values.oldPrice != undefined && !values.fungible && margin / price <= 1) {
        console.log('Not enough margin to update it : ' + values.collectionName);
        return;
    }

    // Get price
    let response;
    if (values.fungible) {
        requestURL = baseURL + '/Moralis/TokenPrice/AVALANCHE/' + tokenAddress + 'avalanche-2';
        response = await axios.get(requestURL)
            .then(function (res) {
                console.log("Correct server response");
                return res.data;
            })
            .catch(function (error) {
                console.log("\nFungible response error\n" + error);
                return;
            });
        if (response == undefined) {
            return;
        }
    } else if (!values.fungible) {
        requestURL = baseURL + 'QuarryDraw/OpenseaCollection/' + values.collectionName + '/avalanche-2/true/false';
        response = await axios.get(requestURL)
            .then(function (res) {
                console.log("Correct server response");
                return res.data;
            })
            .catch(function (error) {
                console.log("\nNon fungible response error\n" + error);
                return undefined;
            });
        if (response == undefined) {
            return;
        }
    }

    // Update oracle, if checks are correct contract will verify them
    let tx;
    let recepit;
    if (values.fungible) {
        try {
            tx = await contract.updateOracleFeed(tokenAddress, ethers.utils.parseEther('' + response.price));
            recepit = await tx.wait(1);

            values.oldPrice = response.price;
            console.log(values.collectionName + ' Fungible token price updated at tx hash: ' + recepit.transactionHash + ' With token price of: ' + values.oldPrice);
        } catch (err) {
            console.log(values.collectionName + ' Fungible token price ERROR');
            console.log(err);

            if (err.response) {
                if (err.response.status == 503) { // timeout error
                    await oracle(tokenAddress);
                }
            }

            return;
        }
    } else if (!values.fungible) {
        try {
            tx = await contract.updateOracleFeed(tokenAddress, ethers.utils.parseEther('' + response.floor));
            recepit = await tx.wait(1);

            values.oldPrice = response.floor;
            console.log(values.collectionName + ' Non-Fungiblle token price updated at tx hash: ' + recepit.transactionHash + ' With token price of: ' + values.oldPrice);
        } catch (err) {
            console.log(values.collectionName + ' Non-Fungible token price ERROR');
            console.log(err);

            if (err.response) {
                if (err.response.status == 503) { // timeout error
                    await oracle(tokenAddress);
                }
            }

            return;
        }
    }
}

/**
 * Contract event filters
 */
filter = {
    address: address,
    topics: [
        [
            ethers.utils.id("Token(bool,address)"),
            ethers.utils.id("TokenManaged(address,uint256,uint256,bool,string)")
        ]
    ]
};

/**
 * Create token feed once it gets created. Based on 
 * event Token(bool indexed created, address indexed token);
 */
contract.on("Token", async (created, token) => {
    console.log("\nToken event");

    if (created) {
        feeds.push(
            {
                address: token,
                oldPrice: undefined,

                timestamp: undefined,
                intervalSetted: false,
                intervalId: undefined,

                fungible: undefined,

                collectionName: undefined
            }
        );
        console.log("\nNew feed created: " + JSON.stringify(feeds[feeds.length - 1]));
        console.log(feeds);
    } else {
        for (i in feeds) {
            if (feeds[i].address == token) {
                console.log('\nClearing from feeds: ' + token);

                if (feeds[i].intervalId != undefined) {
                    console.log('Deleting interval of: ' + token);
                    clearInterval(feeds[i].intervalId);
                    i.intervalId = undefined;
                    i.intervalSetted = false;
                }

                feeds.splice(i, 1);
            }
        }
    }
});

/**
 * Add remove update interval for a token and update feed if margin changes. Based on
 * event TokenManaged(address indexed token, uint256 indexed price, uint256 oracleTimestamp, string data);
 * 
 * remove if changed to non market feed
 */
contract.on("TokenManaged", async (token, e_pricePerToken, e_timestampOracle, fungible, collectionName) => {
    console.log("\nToken Managed event");

    let pricePerToken = Number(e_pricePerToken.toString());
    let timestampOracle = Number(e_timestampOracle.toString());

    for (i in feeds) {
        if (feeds[i].address == token) {
            // eliminate non-market feed tokens
            if (pricePerToken != 0 && feeds[i].intervalId == undefined) {
                console.log('\nNo changes needed for: ' + token);
                return;
            } else if (pricePerToken != 0 && feeds[i].intervalId != undefined) {
                console.log('\nDeleting from price feeds: ' + feeds[i].collectionName);
                clearInterval(feeds[i].intervalId);
                feeds[i].oldPrice = undefined;
                feeds[i].intervalId = undefined;
                feeds[i].intervalSetted = false;
                return;
            }

            console.log('\nUpdating values for: ' + feeds[i].address);

            if (collectionName != "") {
                feeds[i].collectionName = collectionName;
                console.log('New collection name: ' + feeds[i].collectionName);
            }

            if (feeds[i].fungible != fungible) {
                feeds[i].fungible = fungible;
                console.log('New fungible status: ' + feeds[i].fungible);
            }

            if (feeds[i].intervalId == undefined || feeds[i].timestamp != timestampOracle) {
                feeds[i].timestamp = timestampOracle;
                feeds[i].intervalId = setInterval(oracle, (feeds[i].timestamp * 1000) + 300_000, feeds[i].address); // 5 min delay
                feeds[i].intervalSetted = true;
                console.log('New ' + (feeds[i].timestamp * 1000 + 300_000) / 1000 + ' seconds interval to: ' + feeds[i].collectionName);
            }
        }
    }

    await oracle(token);
});