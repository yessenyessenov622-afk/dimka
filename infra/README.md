# Dimka AWS deployment

This stack creates a dedicated VPC, one outbound-only EC2 worker, and private
Multi-AZ PostgreSQL in eu-north-1. The EC2 host has no SSH or other inbound
security-group rules. GitHub Actions assumes a short-lived AWS role through
OIDC and runs the deployment script through Systems Manager. No AWS access key
or Telegram token belongs in GitHub.

The stack defaults are EC2 t3.small with a 16 GB encrypted gp3 root disk, and
PostgreSQL 18.6 on db.t4g.micro with 20 GB encrypted gp3 storage, Multi-AZ,
seven-day backups, Performance Insights, deletion protection, TLS enforcement,
and 30-day encrypted database logs. RDS is not publicly accessible and allows
connections only from the EC2 security group. The bot's database login is
separate from the RDS master account.

Before the bot can start, replace the placeholder value in the
BotTokenSecretArn output with the BotFather token using Secrets Manager. The
secret is encrypted with its own customer-managed KMS key. The token is not
included in this repository or in the stack template. Rotate it manually in
BotFather, then update the same secret; BotFather does not provide an automatic
rotation API.

The deployed workflow is staged as workflow_dispatch until the AWS stack and
OIDC role exist. After the stack is created and the initial token is set, change
the workflow trigger to push on main; that activation commit then performs the
first deploy. Each later main commit deploys that exact commit SHA. The
workflow serializes deployments and reports the SSM command result.

## Estimated monthly AWS usage

At 730 hours per month, current eu-north-1 list prices are approximately:

- t3.small Linux EC2: USD 15.77
- db.t4g.micro PostgreSQL Multi-AZ: USD 24.09
- 20 GB RDS gp3 Multi-AZ storage: USD 4.80
- 16 GB EC2 gp3 root volume: about USD 1.54
- One public IPv4 address: about USD 3.65
- Three customer-managed KMS keys: about USD 3.00
- Two Secrets Manager secrets: about USD 0.80

Estimated baseline total: about USD 54 per month before tax, internet data
transfer, CloudWatch log ingestion, and backup storage above the included
allowance. AWS prices and usage vary. Deletion protection and Retain policies
preserve database data and keys if the stack is removed, so those resources
continue to incur charges until deliberately deleted.

## Deployment scripts

The CloudFormation template is
cloudformation/dimka-production.yaml. It requires the numeric Telegram owner ID
as a stack parameter; the public template does not contain that ID. The runtime
secret helper fetches credentials only when the bot or migrations start.

The initial AWS rollout must create the stack, set the bot token secret, wait
for the worker to register in Systems Manager, then run the deployment for the
main commit. Use the stack outputs for the worker ID, database endpoint,
deployment role, and secret ARNs. Do not put secret values into shell history,
GitHub, UserData, command-line arguments, or CloudFormation parameters.

RDS master credentials are managed and rotated by RDS. The bot uses a separate
restricted database role whose password is stored in Secrets Manager; its
rotation requires updating both the database role and the secret together.

The AWS account currently has no CloudTrail trail. CloudFormation's events and
AWS's event history remain available, but centralized API audit logging is not
configured by this project.
