import { createDAppKit, DAppKitProvider, useCurrentAccount } from '@mysten/dapp-kit-react';
import { ConnectButton } from '@mysten/dapp-kit-react/ui';
import { SuiGrpcClient } from '@mysten/sui/grpc';

const kit = createDAppKit({
  networks: ['mainnet'],
  createClient: network => new SuiGrpcClient({ network, baseUrl: 'https://fullnode.mainnet.sui.io:443' }),
});

function Connection() {
  const account = useCurrentAccount();
  return <section className="research-panel" aria-label="Sui wallet">
    <p className="eyebrow">SUI / MAINNET</p>
    <h2>Your reward wallet.</h2>
    <p>Connect a Sui wallet to preview your reward address. Connecting does not move funds or request a signature.</p>
    <ConnectButton />
    {account && <p role="status" style={{ overflowWrap: 'anywhere' }}>Connected address: {account.address}</p>}
    <p className="account-footnote">This connection is local to this browser. It is not yet verified or linked to your Fieldtest account. Campaign funding and payouts are not available.</p>
  </section>;
}

export default function WalletPanel() {
  return <DAppKitProvider dAppKit={kit}><Connection /></DAppKitProvider>;
}
