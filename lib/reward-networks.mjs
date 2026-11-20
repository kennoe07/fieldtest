export const MAINNET_USDC='0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';
// Circle's published Sui testnet USDC type. Never use it for mainnet funding.
export const TESTNET_USDC='0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC';
const networks=Object.freeze({
 'sui:mainnet':Object.freeze({chain:'mainnet',coinType:MAINNET_USDC,rpc:'https://fullnode.mainnet.sui.io:443'}),
 'sui:testnet':Object.freeze({chain:'testnet',coinType:TESTNET_USDC,rpc:'https://fullnode.testnet.sui.io:443'}),
});
export function rewardNetwork(network){if(typeof network!=='string'||!Object.hasOwn(networks,network))throw Error('Unsupported reward network');return networks[network]}
