---
name: deploy-azure-foundry
description: Deploy the Verify My Interview app (Express + Microsoft Foundry agents) to Azure. Use when the user wants to deploy, ship, publish, containerize, or host this app on Azure — Container Apps, App Service, or Foundry Hosted Agents — or wire up the Foundry project, model deployment, managed identity, or environment variables for production.
---

# Deploy Verify My Interview to Azure

This app is a Node/TypeScript Express server that drives a multi-agent Microsoft
Foundry (Azure AI Foundry) investigation pipeline and serves a web UI. It
authenticates to Foundry with **Microsoft Entra ID** via `DefaultAzureCredential`
(no API keys). In production, use a **managed identity** instead of `az login`.

Recommended target: **Azure Container Apps** (the 2026 "express" mode is agent-first
and scales from zero). Alternative simpler target: **Azure App Service**.

## Prerequisites

- Azure CLI logged in: `az login` and `az account set --subscription <id>`
- Docker installed (for the container path)
- An Azure AI Foundry project + a deployed model (e.g. `gpt-4o`)

## Step 1 — Foundry project + model (if not already created)

Create the project in the Foundry portal (ai.azure.com), deploy a model, and copy
the **project endpoint**:
`https://<resource>.services.ai.azure.com/api/projects/<project>`

Set locally for testing first:

```bash
export AZURE_AI_PROJECT_ENDPOINT="https://<resource>.services.ai.azure.com/api/projects/<project>"
export AZURE_AI_MODEL_DEPLOYMENT="gpt-4o"
npm run build && node dist/src/backend/server.js   # expect trace.engine_mode === "foundry"
```

## Step 2 — Build & push the container image

```bash
RG=vmi-rg
LOC=eastus
ACR=vmiacr$RANDOM
az group create -n $RG -l $LOC
az acr create -n $ACR -g $RG --sku Basic --admin-enabled false
az acr login -n $ACR
docker build -t $ACR.azurecr.io/verify-my-interview:latest .
docker push $ACR.azurecr.io/verify-my-interview:latest
```

## Step 3 — Deploy to Azure Container Apps

```bash
ENV=vmi-env
APP=verify-my-interview
az containerapp env create -n $ENV -g $RG -l $LOC

az containerapp create \
  -n $APP -g $RG --environment $ENV \
  --image $ACR.azurecr.io/verify-my-interview:latest \
  --target-port 3000 --ingress external \
  --registry-server $ACR.azurecr.io \
  --system-assigned \
  --min-replicas 0 --max-replicas 2 \
  --env-vars AZURE_AI_PROJECT_ENDPOINT="$AZURE_AI_PROJECT_ENDPOINT" \
             AZURE_AI_MODEL_DEPLOYMENT="$AZURE_AI_MODEL_DEPLOYMENT" \
             NODE_ENV=production
```

## Step 4 — Grant the app's managed identity access to Foundry

`DefaultAzureCredential` picks up the Container App's **system-assigned managed
identity** at runtime. Give it a role on the Foundry/AI resource so it can call the
agent service (no secrets in the image):

```bash
PRINCIPAL_ID=$(az containerapp show -n $APP -g $RG --query identity.principalId -o tsv)
# Scope to your Azure AI / Foundry resource. "Azure AI Developer" allows agent + model calls.
az role assignment create \
  --assignee "$PRINCIPAL_ID" \
  --role "Azure AI Developer" \
  --scope "<resource-id-of-your-foundry-or-ai-services-resource>"
```

## Step 5 — Validate

```bash
FQDN=$(az containerapp show -n $APP -g $RG --query properties.configuration.ingress.fqdn -o tsv)
curl "https://$FQDN/health"
curl -X POST "https://$FQDN/analyze" -H "Content-Type: application/json" \
  -d '{"evidence":"Pay a $250 gift-card equipment fee to start. Urgent!"}'
# Confirm the response trace.engine_mode is "foundry" (not "deterministic").
```

## Alternative — Azure App Service (container)

```bash
az appservice plan create -n vmi-plan -g $RG --is-linux --sku B1
az webapp create -n verify-my-interview-web -g $RG -p vmi-plan \
  --deployment-container-image-name $ACR.azurecr.io/verify-my-interview:latest
az webapp identity assign -n verify-my-interview-web -g $RG
az webapp config appsettings set -n verify-my-interview-web -g $RG --settings \
  AZURE_AI_PROJECT_ENDPOINT="$AZURE_AI_PROJECT_ENDPOINT" \
  AZURE_AI_MODEL_DEPLOYMENT="$AZURE_AI_MODEL_DEPLOYMENT" WEBSITES_PORT=3000
# Then grant the web app's managed identity the same role as Step 4.
```

## Alternative — Foundry Hosted Agents

To run the agent itself inside Foundry Agent Service (managed identity, scaling,
state), push the image to ACR and register it as a Hosted Agent in the Foundry
project. The dedicated agent identity calls models/tools without embedded secrets.
See: https://learn.microsoft.com/azure/ai-foundry/agents/

## Guardrails (verify before/after deploying)

- **Never** bake `.env`, keys, or the project endpoint secret into the image — pass
  config as Container App env vars and use managed identity for auth.
- Confirm `.dockerignore` excludes `.env`, `.git`, `node_modules`.
- Health check `/health` returns 200; `/analyze` returns `trace.engine_mode: "foundry"`.
- Set `--min-replicas 0` to scale to zero and avoid idle cost during judging.
