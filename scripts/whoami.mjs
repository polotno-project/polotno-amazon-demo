// Confirms that the project-local credentials in .aws/credentials work.
// Replaces `aws sts get-caller-identity` so no AWS CLI is necessary.
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';

const region = process.env.AWS_REGION;
const sts = new STSClient({ region });

try {
  const me = await sts.send(new GetCallerIdentityCommand({}));
  console.log('Region  :', region);
  console.log('Account :', me.Account);
  console.log('ARN     :', me.Arn);
} catch (error) {
  console.error('Credentials do not work.');
  console.error(`${error.name}: ${error.message}`);
  console.error(`\nCredentials file: ${process.env.AWS_SHARED_CREDENTIALS_FILE}`);
  process.exit(1);
}
