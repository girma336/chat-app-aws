const Responses = require('./commen/API_Responses');
const db = require('./commen/DynamoConfig')
const CLIENTS_TABLE_NAME = 'UsersChat';
exports.handler = async event => {
    const output = await db
      .scan({
        TableName: CLIENTS_TABLE_NAME,
      })
      .promise();
  
    const users = output.Items || [];
  
    console.log('event', event);

    // if (!event.pathParameters || !event.pathParameters.ID) {
    //     // failed without an ID
    //     return Responses._400({ message: 'missing the ID from the path' });
    // }

    // let ID = event.pathParameters.ID;

    if (users) {
        // return the data
        return Responses._200(users);
    }

    //failed as ID not in the data
    return Responses._400({ message: 'no user in data' });
};

const data = {
    1234: { name: 'Anna Jones', age: 25, job: 'journalist' },
    7893: { name: 'Chris Smith', age: 52, job: 'teacher' },
    5132: { name: 'Tom Hague', age: 23, job: 'plasterer' },
};