# Local Internet Identity Signed Query Repro

This example is a minimal repro for a local managed `icp` network with Internet Identity enabled.

It demonstrates:

1. An anonymous query to a backend canister succeeds.
2. `AuthClient` login against local Internet Identity succeeds.
3. The first signed query to the same backend canister fails with a delegation trust error.

The example intentionally avoids app-specific session/bootstrap logic. It only uses:

- `@icp-sdk/auth/client`
- `@icp-sdk/core/agent`
- `@icp-sdk/core/agent/canister-env`

## Expected Repro

After deploy:

1. Open the frontend canister URL.
2. Click `Anonymous Query`.
3. Click `Login With Internet Identity`.
4. Click `Signed Query`.

Expected result:

- `Anonymous Query` returns a greeting.
- Login succeeds.
- `Signed Query` fails with an error like:

```text
certificate verification failed: the source subnet ... is not trusted for delegations
```

## Run

Start the managed local network:

```bash
icp network start
```

Deploy the example:

```bash
icp deploy
```

Open the frontend canister URL printed by `icp deploy`.

The example configures local Internet Identity at `id.ai.localhost:4943` and reads `IC_ROOT_KEY` plus the backend canister ID from the `ic_env` cookie exposed by the asset canister.
