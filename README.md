# CredPal DevOps Assessment

> Production-ready DevOps pipeline for a Node.js application.
> **Stack:** Node.js 20 · Express · PostgreSQL · Docker · GitHub Actions · Terraform (AWS ECS Fargate)

---

## Table of Contents

1. [Project Structure](#project-structure)
2. [Running Locally](#running-locally)
3. [Accessing the Application](#accessing-the-application)
4. [CI/CD Pipeline](#cicd-pipeline)
5. [Deploying to Production](#deploying-to-production)
6. [Key Design Decisions](#key-design-decisions)

---

## Project Structure

```
.
├── app/
│   ├── index.js          # Express application (health, status, process endpoints)
│   ├── index.test.js     # Jest unit tests (supertest + pg mock)
│   ├── init.sql          # DB schema bootstrap
│   └── package.json
├── terraform/
│   ├── main.tf           # VPC, subnets, ALB, ACM, ECS Fargate, CloudWatch
│   ├── variables.tf
│   ├── outputs.tf
│   └── terraform.tfvars.example
├── .github/workflows/
│   └── ci-cd.yml         # Test → Build → Approve → Deploy
├── Dockerfile            # Multi-stage, non-root, dumb-init
├── docker-compose.yml    # Local dev stack (app + postgres)
├── .env.example
└── README.md
```

---

## Running Locally

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) >= 24
- [Docker Compose](https://docs.docker.com/compose/) (bundled with Docker Desktop)

### Steps

```bash

git clone https://github.com/adediresolomon234/credpal-devops-assessment.git
cd credpal-devops-assessment


cp .env.example .env



docker compose up --build


curl http://localhost:3000/health
curl http://localhost:3000/status
curl -X POST http://localhost:3000/process \
  -H "Content-Type: application/json" \
  -d '{"action": "test", "value": 123}'


docker compose down -v
```

### Running Tests Directly

```bash
cd app
npm install
npm test
```

---

## Accessing the Application

| Environment | URL | Notes |
|---|---|---|
| Local | `http://localhost:3000` | via docker compose |
| Production | `https://api.credpal.com` | Behind ALB + ACM SSL cert |

### Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Liveness probe  returns 200 + uptime. Does not hit the DB. |
| `GET` | `/status` | Readiness probe  verifies DB connectivity. Returns 503 if DB is down. |
| `POST` | `/process` | Accepts a JSON payload, writes a job record to PostgreSQL, returns the created row. |

---

## CI/CD Pipeline

The pipeline is defined in `.github/workflows/ci-cd.yml` and triggers on every push to `main` and every pull request targeting `main`.

```
┌────────────┐    ┌──────────────────┐    ┌──────────────┐    ┌─────────────┐
│   test     │───▶│ build-and-push   │───▶│   approval   │───▶│   deploy    │
│            │    │                  │    │ (manual gate)│    │             │
│ npm ci     │    │ docker buildx    │    │ via GitHub   │    │ AWS verify  │
│ npm test   │    │ push to GHCR     │    │ Environments │    │ + readiness │
└────────────┘    └──────────────────┘    └──────────────┘    └─────────────┘
                   (only on main push)
```

### Job Breakdown

| Job | Trigger | What it does |
|---|---|---|
| `test` | Every push + PR | Installs deps, runs Jest tests, uploads coverage artifact |
| `build-and-push` | Push to `main` only | Builds Docker image with BuildKit, pushes to GHCR tagged with Git SHA + `latest` |
| `approval` | After build passes | Pauses pipeline  requires manual reviewer signoff via GitHub Environments |
| `deploy` | After approval | Verifies AWS credentials via `sts:GetCallerIdentity` ECS deploy runs once infrastructure is provisioned via Terraform |

### Required GitHub Secrets

| Secret | Description |
|---|---|
| `AWS_ACCESS_KEY_ID` | IAM user access key |
| `AWS_SECRET_ACCESS_KEY` | IAM user secret key |
| `AWS_REGION` | Target AWS region (e.g. `us-east-1`) |

> `GITHUB_TOKEN` is provided automatically by GitHub Actions for GHCR access no manual setup needed.

### Manual Approval Gate

The `approval` job uses a GitHub **Environment** named `production`. To configure it:

1. Go to **Settings → Environments → production** in your repo
2. Add yourself (or a reviewer) as a required reviewer
3. Every push to `main` will pause at this step until approved

---

## Deploying to Production

### Prerequisites

- [Terraform](https://developer.hashicorp.com/terraform/install) >= 1.6.0
- AWS CLI configured with appropriate credentials
- A Route 53 hosted zone for your domain

### First-time Infrastructure Provisioning

```bash
cd terraform


cp terraform.tfvars.example terraform.tfvars

aws ssm put-parameter \
  --name "/credpal/db_user" \
  --value "credpal_user" \
  --type SecureString

aws ssm put-parameter \
  --name "/credpal/db_password" \
  --value "your-strong-password" \
  --type SecureString


terraform init
terraform plan
terraform apply
```

After `terraform apply` completes, add the ECS cluster and service names as GitHub Secrets:
- `ECS_CLUSTER`  from `terraform output ecs_cluster_name`
- `ECS_SERVICE`  from `terraform output ecs_service_name`

### Subsequent Deployments

Every merge to `main` automatically:
1. Runs tests
2. Builds and pushes a new Docker image tagged with the Git SHA
3. Waits for manual approval
4. Triggers a **rolling ECS update** (100% min healthy, 200% max) zero downtime guaranteed

### Terraform State

Remote state is configured via S3 + DynamoDB locking (commented out in `main.tf` for local development). To enable for a team:

```bash

aws s3 mb s3://credpal-terraform-state --region us-east-1
aws dynamodb create-table \
  --table-name credpal-tf-lock \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST
```

Then uncomment the `backend "s3"` block in `terraform/main.tf` and re-run `terraform init`.

---

## Key Design Decisions

### Security

| Decision | Rationale |
|---|---|
| **Non-root container user** | Dockerfile creates `appuser` (UID 1001) process never runs as root, limiting blast radius of a container escape |
| **dumb-init as PID 1** | Ensures `SIGTERM` is forwarded correctly to Node.js for graceful shutdown during rolling deploys |
| **Secrets in SSM Parameter Store** | DB credentials injected at runtime via ECS secrets  never baked into the image or stored in GitHub |
| **Private ECS subnets** | Tasks run in private subnets; only the ALB (public subnets) is internet-facing |
| **HTTPS enforced at ALB** | HTTP listener issues 301 redirect to HTTPS. TLS termination uses TLS 1.3 security policy |
| **Security group least-privilege** | ECS security group only accepts port 3000 from the ALB security group no direct internet access |
| **No secrets in source control** | `.env`, `terraform.tfvars`, and state files are all gitignored |

### CI/CD

| Decision | Rationale |
|---|---|
| **Multi-stage Docker build** | Production image contains no devDependencies or build tooling  smaller and more secure |
| **GitHub Container Registry (GHCR)** | Free for public repos; auth uses automatic `GITHUB_TOKEN`  no separate registry credentials needed |
| **Image tagged with Git SHA** | Every deployment is traceable back to an exact commit; `latest` also updated for convenience |
| **Manual approval gate** | Prevents accidental production deployments; enforces human review between CI and CD |
| **ECS deployment circuit breaker** | If the new task fails its health check, ECS automatically rolls back to the previous task definition |
| **Concurrency cancel-in-progress** | Prevents duplicate pipeline runs on rapid pushes saves Actions minutes |

### Infrastructure

| Decision | Rationale |
|---|---|
| **ECS Fargate over EC2** | No node management, automatic patching, pay-per-task-second pricing |
| **Two availability zones** | ALB and ECS tasks spread across 2 AZs for high availability |
| **Rolling deployment (100/200)** | At least one healthy task stays alive throughout a deployment  zero downtime without the cost of a full blue/green environment |
| **CloudWatch Logs with 30-day retention** | Structured logs shipped via `awslogs` driver; retention cap prevents unbounded cost |
| **S3 remote Terraform state** | Shared state with DynamoDB locking prevents concurrent `terraform apply` runs from corrupting infrastructure |
| **/health vs /status split** | `/health` is a fast liveness check (no DB call) used by the ALB. `/status` is a deep readiness check used by monitoring  separating them prevents ALB from marking a container unhealthy during DB maintenance |
