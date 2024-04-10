const AWS = require('aws-sdk');

const db = new AWS.DynamoDB.DocumentClient();

module.exports = db;