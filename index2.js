const { Telegraf, Scenes, session, Markup  } = require('telegraf');
const { WizardScene } = Scenes;
const {readCredentials, fetchBalance, testApiKey, saveCredentials, validateApiKey, validateApiSecret, closeAllOpenPositions} = require('./helper2')
const bot = new Telegraf('6663162857:AAFpy32O922tMKu9flCr7NifrZpA8xU0ho8'); // Replace with your token
let balanceMonitorInterval = null;


let isBotActive = false; // To keep track of bot's state

bot.start((ctx) => {
    ctx.reply('What would you like to do?', 
        Markup.inlineKeyboard([
            [Markup.button.callback('Balance💳', 'balance'), 
             Markup.button.callback('Add APIKEY🔑', 'addApi')],
            [Markup.button.callback(isBotActive ? 'STOP⏹️' : 'START▶️', 'toggleStart')]
        ]).resize().oneTime()
    );
});


// Create the scene
const apiKeyWizard = new WizardScene(
    'api_key_wizard',
    (ctx) => {
        ctx.reply('Please enter your API key:');
        return ctx.wizard.next();
    },
    (ctx) => {
        const apiKey = ctx.message.text;
        console.log(apiKey)
        if (!validateApiKey(apiKey)) {
            ctx.reply('Invalid API key format. Please try again:');
            return; // Stay at this step
        }
        ctx.wizard.state.apiKey = apiKey; // Temporarily store API key
        ctx.reply('Please enter your API secret:');
        return ctx.wizard.next();
    },
    (ctx) => {
        const apiSecret = ctx.message.text;
        if (!validateApiSecret(apiSecret)) {
            ctx.reply('Invalid API secret format. Please try again:');
            return; // Stay at this step
        }
        // Save API key and secret in session
        ctx.session.apiKey = ctx.wizard.state.apiKey;
        ctx.wizard.state.apiSecret = apiSecret; // Temporarily store API secret
        ctx.reply('Testing API key and secret...');
        testApiKey(ctx.wizard.state.apiKey, ctx.wizard.state.apiSecret)
            .then(isValid => {
                if (!isValid) {
                    ctx.reply('Failed to validate API key and secret with Binance. Please try again.');
                    return ctx.scene.leave();
                }
                // If valid, proceed to save credentials
                ctx.session.credentials = ctx.session.credentials || [];
                ctx.session.credentials.push({ apiKey: ctx.wizard.state.apiKey, apiSecret: ctx.wizard.state.apiSecret });
                saveCredentials(ctx.session.credentials); // Save to file
                ctx.reply('API key and secret tested and saved successfully.');
                return ctx.scene.leave();
            })
            .catch(error => {
                ctx.reply('Error testing API key and secret. Please try again.');
                console.error(error);
                return ctx.scene.leave();
            });
    }
);
bot.action('balance', async (ctx) => {
    await ctx.answerCbQuery();  // Acknowledge the callback query

    const credentials = await readCredentials();
    if (credentials.length === 0) {
        ctx.reply('No API credentials found.');
        return;
    }

    const balancePromises = credentials.map((credential, index) => 
        fetchBalance(credential.apiKey, credential.apiSecret)
            .then(usdtBalanceInfo => {
                if (usdtBalanceInfo.balance !== 'Error' && usdtBalanceInfo.crossUnPnl !== 'Error') {
                    const totalBalance = parseFloat(usdtBalanceInfo.balance) + parseFloat(usdtBalanceInfo.crossUnPnl);
                    return `<b>Account ${index + 1}:\nTotal USDT Balance</b>: ${totalBalance.toFixed(2)}\n\n`;
                } else {
                    return `<b>Account ${index + 1}:\nUnable to fetch balance.<b>\n\n`;
                }
            })
    );

    Promise.all(balancePromises)
        .then(balanceInfos => {
            const responseText = '<b>Balance:</b>\n\n' + balanceInfos.join('');
            ctx.replyWithHTML(responseText);
        })
        .catch(error => {
            console.error('Error fetching balances:', error);
            ctx.reply('<b>⚠️⚠️An error occurred while fetching balances.⚠️⚠️</b>');
        });
});

const thresholdWizard = new WizardScene(
    'threshold_wizard',
    (ctx) => {
        ctx.reply('Please enter the threshold amount (X) for closing positions:');
        return ctx.wizard.next();
    },
    (ctx) => {
        ctx.wizard.state.threshold = parseFloat(ctx.message.text);
        ctx.reply(`Threshold set to ${ctx.wizard.state.threshold}. Starting balance monitoring...`);
        startBalanceMonitoring(ctx, ctx.wizard.state.threshold) // Start monitoring every 10 seconds
        return ctx.scene.leave();
    }
);




const stage = new Scenes.Stage([apiKeyWizard, thresholdWizard]);
bot.use(session());
bot.use(stage.middleware());

bot.action('toggleStart', async (ctx) => {
    await ctx.answerCbQuery();  // Acknowledge the callback query
    isBotActive = !isBotActive;

    if (isBotActive) {
        ctx.scene.enter('threshold_wizard');
    } else {
        stopInterval();
        ctx.reply('Balance monitoring stopped for all accounts.');
    }


    // Update the message with updated buttons
    ctx.editMessageReplyMarkup(
        Markup.inlineKeyboard([
            [Markup.button.callback('Balance💳', 'balance'), 
             Markup.button.callback('Add APIKEY🔑', 'addApi')],
            [Markup.button.callback(isBotActive ? 'STOP⏹️' : 'START▶️', 'toggleStart')]
        ]).resize()
    );
});


bot.action('addApi', async (ctx) => {
    try {
        await ctx.answerCbQuery();  // Acknowledge the callback query
        await ctx.scene.enter('api_key_wizard');
    } catch (error) {
        console.error('Error entering API key wizard:', error);
    }
});


function stopInterval() {
    if (balanceMonitorInterval) {
        clearInterval(balanceMonitorInterval);
        balanceMonitorInterval = null;
    }
}


function startBalanceMonitoring(ctx, thresholdPercentage) {
    balanceMonitorInterval = setInterval(async () => {
        const credentials = await readCredentials();
        if (credentials.length === 0) {
            ctx.reply('No API Keys found, please register them through /start')
            stopInterval()
            return
        }
        for (const [index, credential] of credentials.entries()) {
            const balanceInfo = await fetchBalance(credential.apiKey, credential.apiSecret);

            if (balanceInfo.balance !== 'Error' && balanceInfo.crossUnPnl !== 'Error') {
                const initialWalletBalance = parseFloat(balanceInfo.balance);
                const currentTotalBalance = initialWalletBalance + parseFloat(balanceInfo.crossUnPnl);
                const thresholdAmount = initialWalletBalance * thresholdPercentage / 100;

                if (initialWalletBalance - currentTotalBalance >= thresholdAmount) {
                    await ctx.reply(`❗Alert: Total balance for Account ${index + 1} dropped by more than ${thresholdPercentage}%. Current balance: ${currentTotalBalance.toFixed(2)}`);
                    stopInterval()
                    let closed = await closeAllOpenPositions(credential.apiKey, credential.apiSecret)
                    if (closed){
                        ctx.reply('All the orders has been closed, if you want to monitor your orders again go to /start and start it over')
                    }
                }
            } else {
                await ctx.reply(`Error fetching balance for Account ${index + 1}.`);
            }
        }
    }, 10000); // Check every 10 seconds
}


bot.launch();
console.log('Bot is running!')