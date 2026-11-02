# Existing EC2 deployment

Production uses the existing EC2 instance selected by the owner. The bot and
its data live in separate directories under /opt/karas-telegram-bot and
/var/lib/karas-telegram-bot. This setup does not alter other applications.
The bot uses Telegram long polling and does not open an inbound application
port. systemd starts it at boot and restarts it if the process exits.

The deployment creates no EC2 instance, database service, NAT gateway, load
balancer, Elastic IP, CloudWatch log group, or other application infrastructure.
It uses the existing instance profile and Systems Manager Run Command. Run
Command is offered at no additional cost for EC2 managed nodes.

## Credentials

The bot token is stored as a standard SecureString parameter and the owner ID
as a standard String parameter. Standard Parameter Store parameters do not add
a monthly parameter charge. The EC2 role can read only the two parameters used
by this application.

Initial provisioning copies the values once to a root-owned file with 0600
permissions under /etc/karas-telegram-bot. systemd reads that file when it
starts the bot, so service restarts do not call Parameter Store or KMS. The
AWS-managed SSM KMS key has no monthly key charge; its encrypt/decrypt API
requests are metered. Do not commit .env.

## Deployment

GitHub Actions authenticates through the repository's OIDC trust role and
sends a command through Systems Manager to the EC2 instance carrying the
KarasBotDeployTarget tag. IAM further restricts that role to the selected
instance. The server accepts only commits that belong to main.

The initial workflow is manual. After the first release is deployed and
verified, pushes to main will be enabled for automatic deployment.

To inspect the service through SSM:

    systemctl status karas-telegram-bot.service
    journalctl -u karas-telegram-bot.service --since today

To see local storage usage:

    du -sh /var/lib/karas-telegram-bot

## Free Plan

EC2, its existing disk, its existing public IPv4 address, and outbound data
transfer can consume Free Plan credits. Free Tier eligibility depends on the
account's remaining shared limits and is not guaranteed by the EC2 instance
type alone. Other account resources use the same credit balance.

T3 instances use Standard CPU credit mode. This avoids charges for surplus
CPU credits; if credits run out, CPU performance is limited to the instance
baseline.

When a Free Plan credit balance is exhausted or the plan expires, AWS closes
the Free-plan account instead of automatically converting it to a paid plan.
Resources and data become inaccessible; AWS retains data for 90 days. The
bot therefore cannot be promised to run continuously after shared credits are
depleted. Do not upgrade the account to a paid plan without the owner's
decision.
