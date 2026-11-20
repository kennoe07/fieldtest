# User-controlled CLI publication signing

The user selected the already verified Sui CLI after the installed Glass 0.5.3 signing bridge proved incompatible with address-balance gas expiration. Do not remove chain/epoch/nonce bounds to fit that wallet. The local wallet review server was stopped while unsigned. No signature or publication occurred.

Create a separate user-owned CLI account instead of exporting/importing Glass secrets. The user's existing Glass funds remain at that address. The new account needs its own free testnet SUI. The account's private recovery output must stay in the user's terminal and must not be copied into chat, screenshots, repository files or build artifacts.

The verified binary is under the workspace parent's `work/sui-bin/sui.exe`, version `1.84.0-9dc25070cf2e`, SHA256 `29c02d8593703bc59ce910b14cc8a492380599f29e921458931dc46a1ffee689`. Its command help confirms `client new-address ed25519 ALIAS word24`, explicit client configuration, alias switching and serialized unsigned/signed transaction commands. No CLI signer has been created or used by the agent.

The nonsecret configuration template is in `outputs/fieldtest-cli-client.yaml`. It selects only the fixed official testnet endpoint and known short chain identifier `4c78adac`. It points to a dedicated keystore under `%LOCALAPPDATA%/Fieldtest/SuiTestnet`, outside the project and Git checkout. Initialize only missing files; never overwrite a preexisting keystore or configuration. `SUI_CONFIG_DIR` must point to this dedicated directory for the current terminal session. A temporary empty-keystore configuration of the same shape was checked using `client envs`, without generating or reading private keys.

The user runs account creation locally and switches to alias `fieldtest-testnet` on testnet, then provides only the output of `client active-address`. On reruns, do not create another account over an existing alias. Review the active address and environment instead.

After the new public address is funded, prepare a fresh unsigned publication artifact for that sender and resimulate. The earlier review/approval specified the Glass address and is not transferable to another sender, digest, UpgradeCap recipient, expiration or gas configuration. Show the new exact review before signing. Sign only those bytes locally through the official CLI's serialized-transaction signing mode; do not use a plain `publish` command that rebuilds and executes automatically. Submission remains a separate user-authorized step. No skip-signing flag or impersonation is appropriate.

Confirm the final checkpointed package and UpgradeCap ownership before configuring a deployment policy. Simulated IDs and local signatures alone are not proof of publication. Mainnet production rewards remain disabled, and the existing deployed-site warning remains unresolved.
