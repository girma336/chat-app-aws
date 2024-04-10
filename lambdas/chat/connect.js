const Responses = require('../commen/API_Responses');
const Dynamo = require('../commen/Dynamo');


const CLIENTS_TABLE_NAME = 'UsersChats';
exports.handler = async event => {
    console.log('event', event);

    const { connectionId: connectionID, domainName, stage } = event.requestContext;

    const data = {
        ID: connectionID,
        date: Date.now(),
        messages: [],
        domainName,
        stage,
    };

    await Dynamo.write(data, CLIENTS_TABLE_NAME);

    return Responses._200({ message: 'connected' });
};