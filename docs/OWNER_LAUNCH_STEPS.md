# Owner Launch Steps: Domain And Auth

Last updated: 2026-06-19

These are the launch items that cannot be completed by code or Azure CLI alone.
They require the product owner to control DNS and identity-provider accounts.

## 1. Custom Domain

Official Microsoft guidance: App Service custom domains need a domain mapping
record plus an `asuid` TXT verification record. Subdomains should use CNAME;
root domains use an A record. See Microsoft Learn:

- https://learn.microsoft.com/azure/app-service/app-service-web-tutorial-custom-domain
- https://learn.microsoft.com/azure/app-service/tutorial-secure-domain-certificate

### Recommended

Use a subdomain first, for example:

```text
app.verifymyinterview.com
```

This avoids root-domain IP concerns and uses a stable CNAME.

### Get the exact DNS records

Run:

```powershell
npm run azure:domain -- -HostName app.yourdomain.com -DnsOnly
```

For the current production app, the values will look like:

```text
CNAME app       vmi-online-3907.azurewebsites.net
TXT   asuid.app <Azure custom domain verification id>
```

Create those records at your domain registrar, wait for DNS propagation, then
run:

```powershell
npm run azure:domain -- -HostName app.yourdomain.com
```

For a root domain, pass `-RootDomain`:

```powershell
npm run azure:domain -- -HostName yourdomain.com -RootDomain -DnsOnly
```

After DNS is correct, rerun the same command without `-DnsOnly` to bind the host
and create an App Service managed certificate.

## 2. Real User Auth

The backend can validate Microsoft Entra tokens, meter signed-in users, and store
case history. Do not enable `AUTH_ISSUER` and `AUTH_AUDIENCE` in production until
the frontend sign-in UI is enabled; otherwise users can hit trial/account states
without a way to sign in.

Official Microsoft guidance:

- Redirect URIs for SPA apps:
  https://learn.microsoft.com/entra/identity-platform/how-to-add-redirect-uri
- Expose API scopes:
  https://learn.microsoft.com/entra/identity-platform/scenario-protected-web-api-expose-scopes
- App ID URI and audience guidance:
  https://learn.microsoft.com/entra/identity-platform/security-best-practices-for-app-registration

### Owner decisions needed

1. Create or select a Microsoft Entra External ID tenant.
2. Configure Google social sign-in in that tenant.
3. Configure Apple social sign-in in that tenant.
4. Decide the final redirect URI:
   `https://app.yourdomain.com` or the Azure URL while the domain is pending.
5. Decide the admin operator email(s).

### App registration shape

In the External ID tenant:

1. Create an app registration for the SPA/API.
2. Add SPA redirect URI:
   `https://app.yourdomain.com`
3. Expose an API:
   `api://<application-client-id>`
4. Add a delegated scope:
   `access_as_user`
5. Add optional/access-token claims needed by the API:
   `email`, `preferred_username`, `name`
6. Copy:
   - Application/client ID
   - Tenant ID
   - Issuer URL from OpenID configuration
   - Scope URL: `api://<client-id>/access_as_user`

### Backend settings

After frontend sign-in is ready, set these on both canary and production:

```powershell
$issuer = "https://<external-id-tenant>.ciamlogin.com/<tenant-id>/v2.0"
$clientId = "<application-client-id>"
$audience = "$clientId,api://$clientId"
$salt = "<generate-a-long-random-value>"

az webapp config appsettings set `
  -g rg-kkgawatlh9-6623 `
  -n vmi-api-3907 `
  --settings AUTH_ISSUER=$issuer AUTH_AUDIENCE=$audience AUTH_ANON_SALT=$salt AUTH_ANON_TRIAL_MAX=1

az webapp config appsettings set `
  -g rg-kkgawatlh9-6623 `
  -n vmi-online-3907 `
  --settings AUTH_ISSUER=$issuer AUTH_AUDIENCE=$audience AUTH_ANON_SALT=$salt AUTH_ANON_TRIAL_MAX=1
```

Then confirm:

```powershell
Invoke-RestMethod https://vmi-online-3907.azurewebsites.net/health
```

Expected:

```text
accounts: true
```

### Frontend settings

When MSAL is added to the frontend, it should use:

```text
VITE_AUTH_CLIENT_ID=<application-client-id>
VITE_AUTH_AUTHORITY=https://<external-id-tenant>.ciamlogin.com/<tenant-id>
VITE_AUTH_SCOPE=api://<application-client-id>/access_as_user
```

The frontend must register an access-token provider with
`setAuthTokenProvider()` in `frontend/src/lib/api.ts`.

### Do not do this

- Do not set `ALLOW_INSECURE=1` for public beta.
- Do not enable auth until users have a visible sign-in path.
- Do not store Google/Apple provider secrets in the repo.
- Do not publish the app broadly before privacy/terms pages are live.
