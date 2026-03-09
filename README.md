# CredPal DevOps Assessment – Adedire

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
│   ├── main.tf           # VPC, subnets, ALB, ACM, ECS Fargate
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

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) ≥ 24
- [Docker Compose](https://docs.docker.com/compose/) (bundled with Docker Desktop)

### Steps

```bash
# 1. Clone the repository
git clone https://github.com/your-org/credpal-devops-assessment.git
cd credpal-devops-assessment

# 2. Create your local environment file
cp .env.example .env
# Edit .env and set a strong DB_PASSWORD

# 3. Start the stack
docker compose up --build

# 4. Verify
curl http://localhost:3000/health
curl http://localhost:3000/status
curl -X POST http://localhost:3000/process \
  -H "Content-Type: application/json" \
  -d '{"payload": {"action": "test"}}'

# 5. Tear down
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
| Local | `http://localhost:3000` | docker compose |
| Production | `https://api.credpal.com` | Behind ALB + ACM cert |

### Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Liveness probe – returns 200 + uptime |
| `GET` | `/status` | Readiness probe – checks DB connectivity |
| `POST` | `/process` | Accepts `{ "payload": {...} }`, inserts a job row |

---

## CI/CD Pipeline

The pipeline lives in `.github/workflows/ci-cd.yml` and is triggered on every push to `main` and every pull request targeting `main`.

```
┌────────────┐    ┌──────────────────┐    ┌──────────────┐    ┌─────────────┐
│   test     │───▶│ build-and-push   │───▶│   approval   │───▶│   deploy    │
│            │    │                  │    │  (manual gate│    │ (ECS rolling│
│ npm ci     │    │ docker buildx    │    │  via GitHub  │    │  update)    │
│ npm test   │    │ push → GHCR      │    │  Environments│    │             │
└────────────┘    └──────────────────┘    └──────────────┘    └─────────────┘
                   (only on main push)
```

### Required GitHub Secrets

| Secret | Description |
|---|---|
| `AWS_ACCESS_KEY_ID` | IAM user with ECS/ECR permissions |
| `AWS_SECRET_ACCESS_KEY` | Corresponding secret key |
| `AWS_REGION` | Target AWS region (e.g. `us-east-1`) |
| `ECS_CLUSTER` | ECS cluster name output by Terraform |
| `ECS_SERVICE` | ECS service name output by Terraform |

> `GITHUB_TOKEN` is provided automatically by GitHub Actions for GHCR access.

### Manual Approval Gate

The `approval` job uses a GitHub **Environment** named `production`. To enable the gate:

1. Go to **Settings → Environments → production** in your repo.
2. Add required reviewers.
3. Any push to `main` will pause at the approval step until a reviewer approves.

---

## Deploying to Production

### First-time Terraform Bootstrap

```bash
cd terraform

# Copy and fill in your values
cp terraform.tfvars.example terraform.tfvars
nano terraform.tfvars

# Initialise Terraform (uses S3 backend – create the bucket first)
terraform init

# Preview the plan
terraform plan

# Apply
terraform apply
```

> **DB credentials** are stored in AWS SSM Parameter Store (not in Terraform state).  
> Create them once before applying:
>
> ```bash
> aws ssm put-parameter --name "/credpal/db_user" \
>   --value "credpal_user" --type SecureString
> aws ssm put-parameter --name "/credpal/db_password" \
>   --value "your-strong-password" --type SecureString
> ```

### Subsequent Deployments

After the infrastructure is in place, every merge to `main` automatically:
1. Runs tests
2. Builds and pushes a new Docker image tagged with the Git SHA
3. Waits for manual approval
4. Triggers a **rolling ECS update** (100 % min healthy, 200 % max) — zero downtime

---

## Key Design Decisions

### Security

| Decision | Rationale |
|---|---|
| **Non-root container user** | The Dockerfile creates `appuser` (UID 1001) so the process never runs as root, limiting blast radius of a container escape. |
| **dumb-init as PID 1** | Ensures `SIGTERM` is forwarded correctly to Node.js for graceful shutdown. |
| **Secrets in SSM Parameter Store** | DB credentials are injected at runtime via ECS secrets — never baked into the image or stored in GitHub. |
| **Private ECS subnets** | Tasks run in private subnets; only the ALB (in public subnets) is internet-facing. |
| **ALB forces HTTPS** | HTTP listener issues a 301 redirect to HTTPS. TLS termination uses the TLS 1.3 security policy. |
| **SG least-privilege** | The ECS security group only accepts traffic on port 3000 from the ALB security group. |
| **`.gitignore` guards** | `.env`, `terraform.tfvars`, and state files are excluded from version control. |

### CI/CD

| Decision | Rationale |
|---|---|
| **Multi-stage Docker build** | Keeps the production image lean (no devDependencies, no build tooling). |
| **GitHub Container Registry** | Free for public repos; GHCR tokens are scoped to the repo via `GITHUB_TOKEN` — no separate registry credentials needed. |
| **Image tagged with Git SHA** | Ensures every deployment is traceable back to an exact commit; `latest` is also updated for convenience. |
| **Manual approval environment** | Prevents accidental production deployments; enforces a human review step between CI and CD. |
| **ECS deployment circuit breaker** | If the new task fails its health check, ECS automatically rolls back to the previous task definition. |

### Infrastructure

| Decision | Rationale |
|---|---|
| **ECS Fargate over EC2** | No node management, automatic patching, and pay-per-task-second pricing suits a lean team. |
| **Two AZs** | ALB and ECS tasks are spread across two availability zones for HA. |
| **Rolling deployment (100/200)** | At least one healthy task stays alive throughout a deployment, ensuring zero downtime without the cost of a full blue/green environment. |
| **CloudWatch Logs with 30-day retention** | Structured application logs are shipped to CloudWatch via `awslogs` driver; retention cap avoids unbounded cost. |
| **S3 remote Terraform state** | Shared state with DynamoDB locking prevents concurrent applies from corrupting infrastructure. |
