let ws = require("nodejs-websocket");
let sanitizer = require('sanitizer');
let config = require('./config.json');
let log4js = require('log4js');
log4js.configure({
    appenders: { main: { type: 'file', filename: 'main.log' } },
    categories: { default: { appenders: ['main'], level: 'debug' } }
  });
let logger = log4js.getLogger('main');
logger.level = 'debug';
let clients = [];
let messages = [];

function processUserMsg(data, client) {

    switch(data.type) {
        case 'validation':
            validateName(data.message, client);
            break;
        case 'register':
            registerClient(data.message, client);
            break;
        case 'message':
            postChatMessage(data.message, client);
            break;
        default:
            console.log('undefined command received');
    }
}

function isNameFree(name) {
    let isValid = true;
    validation: {
        if (!name.trim().length) {
            console.log()
            isValid = false;
            break validation;
        }
        for (let user of clients) {
            if (!user.name) { continue; }
            if (user.name.trim().toLowerCase() === name.trim().toLowerCase()) {
                isValid = false;
                break validation;
            }
        }
    }
    return isValid;
}

function validateName(name, client) {
    logger.info('validate name method called', name);
    let isValid = isNameFree(name);
    client.sendText(JSON.stringify({
        type: 'validation',
        success: isValid,
        message: isValid ? 'name is free' : 'name is already registered'
    }));
}

function postChatMessage(msg, client) {
    
    if (!client.name) {
        logger.error('unregistered client tries to send message', msg, client);
        return;
    }
    logger.info('post chat message', msg, client.name);
    let message = {
        date: new Date(),
        author: client.name,
        content: msg
    };
    messages.push(message);
    if (messages.length > config.cacheSize) { // keep cache size under control
        messages = messages.slice(messages.length - config.cacheSize - 1, messages.length - 1);
    }
    for (let user of clients) {
        if (!user.name) { continue; }
        console.log('publish');
        user.sendText(JSON.stringify({
            type: 'message',
            message,
            success: true
        }));
    }
}

function registerClient(name, client) {
    logger.info(name, 'entered');
    if (isNameFree(name, client)) {
        sendSystemMessage(name + ' came here!');
        client.name = name;
        client.sendText(JSON.stringify({
            type: 'register',
            message: messages,
            success: true
        }));
        return;
    }
    client.sendText(JSON.stringify({
        type: 'register',
        success: false,
        message: 'INVALID NAME'
    }));
}

function sendSystemMessage(msg) {
    for (let user of clients) {
        if (!user.name) { continue; }
        user.sendText(JSON.stringify({
            type: 'message',
            message: {
                date: new Date(),
                author: '',
                content: msg
            },
            success: true
        }));
    }
}

function setIdle(conn) {
    if (conn.idle) { clearTimeout(conn.idle);}
    conn.idle = setTimeout(() => {
        logger.debug('idle kick', conn.key);
        conn.close(1001, 'timeout');
        if (!conn.name) { return; }
        sendSystemMessage(conn.name + ' disconnected due inactivity.');
    }, config.idleTimeMs);
}

let server = ws.createServer(function (conn) {
    logger.info('new connection', conn.key);
    clients.push(conn);
    setIdle(conn);
    conn.on("text", function (str) {
        setIdle(conn);
        let data = JSON.parse(str);
        logger.debug('data received', data);
        data.message = sanitizer.sanitize(data.message);
        processUserMsg(data, this);
    });
    conn.on("close", function (err) {
        console.log('connection closed', err);
        if (err !== 1001 && conn.name) {
            sendSystemMessage(conn.name + ' left.')
        }
        clients.splice(clients.indexOf(this), 1); // remove 
    });
    conn.on("error", function (code, reason) {
        sendSystemMessage(conn.name + ' left.')
        console.log("error", code, reason);
    });
}).listen(config.port);
console.log('server started on port', config.port);

function stop() {
    console.log('Stop server');
    sendSystemMessage('server is stopping...');
    server.close(() => {
      console.log('server closed');
      process.exit(0);
    });
}

process.on('SIGTERM', () => {
    console.info('SIGTERM signal received.');
    stop();
});
process.on('SIGINT', () => {
    console.info('SIGINT signal received.');
    stop();
});
