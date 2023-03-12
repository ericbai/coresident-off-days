# Coresident Off Days

Displays residents that are off or may be off given a date within supported date range.

This is a simple Node Express API service, backed by DynamoDB database, running on AWS Lambda using the traditional Serverless Framework. Contains a single function, `api`, which is responsible for handling all incoming requests thanks to the `httpApi` event. As the event is configured in a way to accept all incoming requests, `express` framework is responsible for routing and handling requests internally. Implementation takes advantage of `serverless-http` package, which allows you to wrap existing `express` applications.

## Commands

- Install: `npm install`
- Local development: `npm start`
- Deployment: `npm run deploy`

Assumes two AWS profiles: `off-days-tracker` during local development and `sls-deployer` during deployment
