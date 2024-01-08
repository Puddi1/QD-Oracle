# Quarry Draw Oracle

This is a three repo project: Quarry Draw Oracle, [Quarry Draw Oracle Server](https://github.com/Puddi1/QD-OracleServer) and [Quarry Draw Validator Contracts](https://github.com/Puddi1/QD-Validator-Contracts).

The project consist of an on-chain price feed Oracle.

The Oracle uses a series of GET API endpoints provided by the [Quarry Draw Oracle Server](https://github.com/Puddi1/OracleServer) to fetch price data, then on a regular time basis it updates the on-chain price.

## Usage

Start with adding the environment variables in your `.env` that are needed in the oracle, where:

- `BASE_URL` is the base URL of the [Quarry Draw Oracle Server](https://github.com/Puddi1/QD-OracleServer)
- `RPC` is the blockchain rpc URL the Oracle will send transactions to.
- `ORACLE_WALLET_PRIVATE_KEY` is the private key of the wallet the Oracle will use to transact.
- `CONTRACT_ADDRESS` is the address of the contract the Oracle will send transactions to.

For syntax example refer to `.env.example`

Before running the script install all required packages:
```sh
npm i
```

Then run the Oracle with any js runtime (node):
```sh
node index.js
```
