const Responses = require('../commen/API_Responses');
const db = require('../commen/DynamoConfig');
const AWS = require('aws-sdk');
const uuid = require("uuid");

const CLIENTS_TABLE_NAME = 'UsersChat';
const MESSAGES_TABLE_NAME = 'ChatTables';

const create = (domainName, stage) => {
  const endpoint = `${domainName}/${stage}`;

  return new AWS.ApiGatewayManagementApi({
    endpoint,
  });
};
const send = ({ domainName, stage, connectionId, data}) => {
  const ws = create(domainName, stage);

  const postParam = {
    Data: data,
    connectionId,
  };
  return ws.postToConnection(postParam).promise();
};

const handler = async (event) => {
    const connectionId = event.requestContext.connectionId;
    const routeKey = event.requestContext.routeKey ;
    const { domainName, stage } = event.requestContext;
    try {
      switch (routeKey) {
        case "$connect":
          return handleConnect(connectionId, event.queryStringParameters, domainName, stage);
        case "$disconnect":
          return handleDisconnect(connectionId, domainName, stage);
        case "getClients":
          return getUser(connectionId);
        case "sendMessage":
          return handleSendMessage(
            await getUser(connectionId),
            parseGetMessageBody(event.body),
            domainName, stage
          );
        case "getMessages":
          return getMessagesFromGSI(
            await getUser(connectionId),
            parseGetMessageBody(event.body),
            domainName, stage
          );
        default:
          return Responses._403({message: "Forbidden"});
      }
    } catch (e) {
      if (e) {
        await postToConnection(
          connectionId,
          domainName, 
          stage,
          JSON.stringify({ type: "error", message: e.message }),
        );
        return Responses._500({  message: "Internal Server error" });
      }
  
      throw e;
    }
  };
  
  const handleConnect = async (
    connectionId, 
    queryParameters,
    domainName,
    stage
  ) => {
    if (!queryParameters || !queryParameters["useName"]) {
      return Responses._403({ message: "Forbidden"});
    }
  
    const existingConnectionId = await getConnectionIdByUserName(
      queryParameters["userName"],
    );
    if (
      existingConnectionId && 
      (await postToConnection(
        existingConnectionId,
        domainName,
        stage,
        JSON.stringify({ type: "ping" }),
      ))
    ) {
      return Responses._403({ message: "Forbidden" });
    }
  
    await db
      .put({
        TableName: CLIENTS_TABLE_NAME,
        Item: {
          connectionId,
          useName: queryParameters["userName"],
        },
      })
      .promise();
  
    await notifyClientChange(connectionId, domainName, stage);
  
    return Responses._200({message: "User connected successfully"});
  };
  
  const handleDisconnect = async (connectionId, domainName, stage) => {
    await db
      .delete({
        TableName: CLIENTS_TABLE_NAME,
        Key: {
          connectionId,
        },
      })
      .promise();
  
    await notifyClientChange(connectionId, domainName, stage);
  
    return Responses._200({ message: "User disconnect successfully"});
  };
  const notifyClientChange = async (excludedConnectionId, domainName, stage) => {
    const clients = await getAllUsers();
  
    await Promise.all(
      clients.map(async (c) => {
        if (excludedConnectionId === c.connectionId) {
          return;
        }
  
        await postToConnection(
          c.connectionId,
          domainName, 
          stage,
          JSON.stringify({ type: "Users", value: clients }),
        );
      }),
    );
  };
  
  const postToConnection = async (
    connectionId,
    domainName,
    stage,
    messageBody,
  ) => {
    try {
      await send(connectionId, domainName, stage, messageBody);
      return true;
    } catch (e) {
      throw new Error(`User connection failed ${e}`);
    }
  };
  
const getConnectionIdByUserName = async (
    userName,
  ) => {
    const output = await db
      .query({
        TableName: CLIENTS_TABLE_NAME,
        IndexName: "UserNameIndex",
        KeyConditionExpression: "#userName = :userName",
        ExpressionAttributeNames: {
          "#userName": "userName",
        },
        ExpressionAttributeValues: {
          ":userName": userName,
        },
      })
      .promise();
  
    return output.Items && output.Items.length > 0
      ? output.Items[0].connectionId
      : undefined;
  };

  const getAllUsers = async () => {
    const output = await db
      .scan({
        TableName: CLIENTS_TABLE_NAME,
      })
      .promise();
  
    const users = output.Items || [];
  
    return users;
  };

  const getUser = async (connectionId) => {
    const output = await db
      .get({
        TableName: CLIENTS_TABLE_NAME,
        Key: {
          connectionId,
        },
      })
      .promise();
  
    if (!output.Item) {
      throw new Error("User does not exist");
    }
  
    return output.Item;
  };
  

  const getMessagesFromGSI = async (clients, body, domainName, stage) => {
    const userNameToUserName = getUserNameToUserName([
      clients.userName,
      body.targetUserName,
    ]);
    const params = {
      TableName: MESSAGES_TABLE_NAME,
      IndexName: 'FromToIndex',
      ScanIndexForward: true,
      KeyConditionExpression: '#fromId = :fromId',
      ExpressionAttributeNames: {
        '#fromId': 'fromId',
      },
      ExpressionAttributeValues: {
        ':fromId': userNameToUserName,
      },
    };
  
    try {
      const output = await db.query(params).promise();

      await postToConnection(
        clients.connectionId,
        domainName, 
        stage,
        JSON.stringify({
          type: "messages",
          value: {
            messages: output.Items && output.Items.length > 0 ? output.Items : [],
            lastEvaluatedKey: output.LastEvaluatedKey,
          },
        }),
      );
    } catch (error) {
      console.error('Error getting messages from GSI:', error);
      return [];
    }
  };

const getUserNameToUserName = (userName) =>
  userName.sort().join("#");

const handleSendMessage = async (client, body, domainName, stage) => {
    const userNameToUserName = getUserNameToUserName([
      client.userName,
      body.recipientUserName,
    ]);
  
    await db
      .put({
        TableName: MESSAGES_TABLE_NAME,
        Item: {
          messageId: uuid.v4(),
          message: body.message,
          fromId: userNameToUserName,
          told: new Date().getTime(),
          Data: new Date().getTime(),
        },
      })
      .promise();
  
    const recipientConnectionId = await getConnectionIdByUserName(
      body.recipientUserName,
    );
  
    if (recipientConnectionId) {
      await postToConnection({
          ConnectionId: recipientConnectionId,
          domainName, 
          stage,
          Data: JSON.stringify({
            type: "message",
            value: {
              sender: client.userName,
              message: body.message,
            },
          }),
        })
        .promise();
    }
  
    return Responses._200({ message: "Send Message Successfuly" });
  };

  const parseGetMessageBody = (body) => {
    const getMessagesBody = JSON.parse(body || "{}");
  
    if (
      !getMessagesBody ||
      !getMessagesBody.targetNickname ||
      !getMessagesBody.limit
    ) {
      throw new Error("invalid GetMessageBody");
    }
  
    return getMessagesBody;
  };
  
module.exports = handler;

