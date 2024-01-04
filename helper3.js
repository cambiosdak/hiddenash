const fs = require('fs').promises;
const axios = require('axios');
const crypto = require('crypto');


function validateApiKey(apiKey) {
    return /^[A-Za-z0-9]{64}$/.test(apiKey);
}

function validateApiSecret(apiSecret) {
    return /^[A-Za-z0-9]{64}$/.test(apiSecret);
}


async function saveCredentials(credentials) {
    try {
        await fs.writeFile('credentials3.json', JSON.stringify(credentials, null, 2));
    } catch (error) {
        console.error('Error saving credentials:', error);
    }
}

async function testApiKey(apiKey, apiSecret) {
    const baseUrl = 'https://fapi.binance.com';
    const endpoint = '/fapi/v2/balance';
    const timestamp = Date.now();

    const queryString = `timestamp=${timestamp}`;
    const signature = crypto
        .createHmac('sha256', apiSecret)
        .update(queryString)
        .digest('hex');

    const url = `${baseUrl}${endpoint}?${queryString}&signature=${signature}`;
    const headers = {
        'X-MBX-APIKEY': apiKey
    };

    try {
        const response = await axios.get(url, { headers });
        return response.status === 200;
    } catch (error) {
        console.error('API key test failed:', error);
        return false;
    }
}

async function fetchBalance(apiKey, apiSecret) {
    // Similar setup as in testApiKey
    const baseUrl = 'https://fapi.binance.com';
    const endpoint = '/fapi/v2/balance';
    const timestamp = Date.now();

    const queryString = `timestamp=${timestamp}`;
    const signature = crypto
        .createHmac('sha256', apiSecret)
        .update(queryString)
        .digest('hex');

    const url = `${baseUrl}${endpoint}?${queryString}&signature=${signature}`;
    const headers = { 'X-MBX-APIKEY': apiKey };

    try {
        const response = await axios.get(url, { headers });
        const usdtBalance = response.data.find(entry => entry.asset === 'USDT');

        if (!usdtBalance) {
            return { balance: 'Unavailable', crossUnPnl: 'Unavailable', asset: 'USDT' };
        }

        return {
            asset: 'USDT',
            balance: usdtBalance.balance,
            crossUnPnl: usdtBalance.crossUnPnl
        };
    } catch (error) {
        console.error('Error fetching balance:', error);
        return { balance: 'Error', crossUnPnl: 'Error', asset: 'USDT' };
    }
}

async function readCredentials() {
    try {
        const data = await fs.readFile('credentials.json', 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Error reading credentials:', error);
        return [];
    }
}


async function fetchOpenPositions(apiKey, apiSecret) {
    const baseUrl = 'https://fapi.binance.com';
    const endpoint = '/fapi/v2/positionRisk';
    const timestamp = Date.now();

    const queryString = `timestamp=${timestamp}`;
    const signature = crypto
        .createHmac('sha256', apiSecret)
        .update(queryString)
        .digest('hex');

    const url = `${baseUrl}${endpoint}?${queryString}&signature=${signature}`;

    try {
        const response = await axios.get(url, {
            headers: {
                'X-MBX-APIKEY': apiKey
            }
        });
        // Filter positions where positionAmt is not '0'
        const openPositions = response.data.filter(position => Math.abs(parseFloat(position.positionAmt)) > 0);
        return openPositions; // The list of filtered open positions
    } catch (error) {
        console.error('Error fetching open positions:', error);
        return []; // Return an empty array in case of an error
    }
}

async function closePosition(apiKey, apiSecret, symbol, positionAmt) {
    const baseUrl = 'https://fapi.binance.com';
    const endpoint = '/fapi/v1/order';
    const timestamp = Date.now();
    // Determine the order side: 'BUY' to close shorts, 'SELL' to close longs
    const orderSide = parseFloat(positionAmt) > 0 ? 'SELL' : 'BUY';
    // Ensure the quantity is positive
    const quantity = Math.abs(parseFloat(positionAmt)).toString();
    // Constructing the query string without encodeURIComponent
    let queryString = `symbol=${symbol}&side=${orderSide}&type=MARKET&quantity=${quantity}&timestamp=${timestamp}&recvWindow=60000`;
    const signature = crypto.createHmac('sha256', apiSecret).update(queryString).digest('hex');
    const url = `${baseUrl}${endpoint}?${queryString}&signature=${signature}`;
    let options = {
        method: 'POST',
        url: url,
        headers: {
            'X-MBX-APIKEY': `${apiKey}` // APIKEY OF ACCOUNT B
        },
    }
    try {
        const response = await axios.request(options);
        return response.data; // The response from the API
    } catch (error) {
        console.error('Error placing market order:', error.response ? error.response.data : error.message);
        return null; // Return null in case of an error
    }
}



async function closeAllOpenPositions(apiKey, apiSecret) {
    const openPositions = await fetchOpenPositions(apiKey, apiSecret);
    for (const position of openPositions) {
        const closeOrderResult = await closePosition(apiKey, apiSecret, position.symbol, position.positionAmt);
        if (closeOrderResult) {
            console.log(`Closed position for ${position.symbol}:`, closeOrderResult);
            return true
        } else {
            console.log(`Failed to close position for ${position.symbol}`);
            return false
        }
    }
}


module.exports = {readCredentials, fetchBalance, testApiKey, saveCredentials, validateApiKey, validateApiSecret, fetchOpenPositions, closePosition, closeAllOpenPositions}