# Off-site backups: a bucket for the database dumps

Every night the `backup` service dumps the database to the server's own disk
([../backups.md](../backups.md)). A disk dies with its server, so this page
sets up a copy somewhere else: a private bucket at another provider, a key
the server can only **write** with, and a second key, kept off the server, for
the day you restore. They go in the `BACKUP_S3_*` variables.

It is optional, and the most valuable hour you can spend before launch: the
day you need it is the day the server is gone.

| | |
|---|---|
| Needed in development | No |
| Needed in production | Not to run, but strongly recommended |
| Cost | Backblaze B2: the first 10 GB free, then a few dollars per TB a month. AWS S3 and R2: cents a month for a small database. Check each pricing page |
| Time | 30 minutes |
| You end with | `BACKUP_S3_BUCKET`, `BACKUP_S3_ENDPOINT`, `BACKUP_S3_REGION`, `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY`, `BACKUP_S3_PREFIX`, `BACKUP_S3_KEEP_DAYS` in `.env.production`, and a read key in your password manager |
| The web app needs | Nothing |

- [The plan, and why](#the-plan-and-why)
- [What the backup does with the bucket](#what-the-backup-does-with-the-bucket)
- [Choosing a provider](#choosing-a-provider)
- [Option A: Backblaze B2](#option-a-backblaze-b2)
- [Option B: AWS S3](#option-b-aws-s3)
- [Option C: Cloudflare R2](#option-c-cloudflare-r2)
- [Put the values in the env file](#put-the-values-in-the-env-file)
- [Check it works](#check-it-works)
- [Common mistakes](#common-mistakes)

## The plan, and why

1. **A different provider from the server's.** If your server is at Hetzner,
   don't keep the backups at Hetzner. One account problem (a billing dispute,
   a locked account, a region outage) should not take both.
2. **The server's key can only write.** Anyone who takes over the server has
   its key. If that key can delete, they can delete your backups too, and
   ransomware does exactly that.
3. **`BACKUP_S3_KEEP_DAYS=0`.** The backup then never tries to delete old
   dumps from the bucket (with a write-only key, it couldn't).
4. **The bucket deletes old dumps itself**, with a **lifecycle rule** (a
   setting on the bucket: "delete files in this folder after 30 days").
5. **A second key that can list and read**, for restores. It lives in your
   password manager with a copy of `.env.production`, never on the server.

## What the backup does with the bucket

The scripts use [rclone](https://rclone.org) and need no config file: the
remote is built from the `BACKUP_S3_*` variables
([backup-common.sh](../../backup/backup-common.sh)).

| What | rclone command | Permission the key needs |
|---|---|---|
| Upload each night's dump ([backup.sh](../../backup/backup.sh)) | `copyto --no-check-dest --s3-no-head`: one plain upload, no check first, no read after | Write |
| Copy uploaded files, when `STORAGE_TYPE=local` | `copy --no-check-dest --s3-no-head`, only files changed since the last copy | Write |
| Remove dumps older than `BACKUP_S3_KEEP_DAYS` (when it is above 0) | `delete --min-age` | List and delete |
| List, download and restore ([restore.sh](../../backup/restore.sh)) | `lsf`, `copyto` | List and read |

The scripts never check that the bucket exists (`RCLONE_S3_NO_CHECK_BUCKET=true`),
since a write-only key can't. That is also why a wrong bucket name only shows
up as a failed upload.

What lands where, with `BACKUP_S3_PREFIX=myapp/` and the database `myapp_db`:

```
myapp-backups/                       the bucket
  myapp/myapp_db/20261005T030000Z.dump          nightly dumps
  myapp/myapp_db/20261005T141500Z-pre-deploy-....dump   taken by deploy.sh before migrations
  myapp/uploads/avatars/...          uploaded files, only with STORAGE_TYPE=local
```

Dump names are timestamps, so a normal run never overwrites a file. Uploaded
files are copied, never mirrored: a file deleted on the server stays in the
bucket. An avatar bucket (`STORAGE_TYPE=s3`) is **not** copied; turn on
versioning on that bucket instead ([storage-s3-r2.md](./storage-s3-r2.md)).

## Choosing a provider

| Provider | Write-only key? | Notes |
|---|---|---|
| [Backblaze B2](#option-a-backblaze-b2) | **Yes**, built in | Recommended. Cheap, simple keys |
| [AWS S3](#option-b-aws-s3) | Yes, with an IAM policy | More steps; versioning protects against overwrites |
| [Cloudflare R2](#option-c-cloudflare-r2) | **No**: the narrowest key reads and writes | Protect the dumps with a bucket lock rule instead |

## Option A: Backblaze B2

### The bucket

1. Sign up at <https://www.backblaze.com> for **B2 Cloud Storage**. You pick
   the account's region (US West, US East or EU Central) at sign-up.
2. **Buckets** → **Create a Bucket**:
   - **Bucket Unique Name**: e.g. `myapp-backups` (unique across all of B2).
   - **Files in Bucket are**: **Private**.
   - **Default Encryption**: **Enable**.
   - **Object Lock**: leave **Disable** unless you know you want it.
   - Click **Create a Bucket**.
3. On the bucket's card, note the **Endpoint**, e.g.
   `s3.us-west-004.backblazeb2.com`. The part between `s3.` and
   `.backblazeb2.com` (`us-west-004`) is the region.

### The lifecycle rule (B2 deletes old dumps)

On the bucket's card, click **Lifecycle Settings** → **Use custom lifecycle
rules**. (If the labels differ, look for the option that takes a file-name
prefix and day counts; B2 may call the two numbers **Days Till Hide** and
**Days Till Delete**.) Add:

| File name prefix | Days from uploading to hiding | Days from hiding to deleting |
|---|---|---|
| `myapp/myapp_db/` (one rule per database) | `30` | `7` |

B2 first **hides** a file (it disappears from listings), then deletes it.
Seven days between the two give you time to notice if someone with the write
key hid files they shouldn't have. Don't add a rule for `myapp/uploads/`: an
avatar that hasn't changed in a month is still needed.

### The two keys

1. Left menu → **Application Keys** → **Add a New Application Key**.
2. The **write key**, for the server:
   - **Name of Key**: `myapp-backup-writer`
   - **Allow access to Bucket(s)**: `myapp-backups`
   - **Type of Access**: **Write Only**
   - **Allow List All Bucket Names**: leave unticked; the backup doesn't need
     it.
   - **File name prefix**: `myapp/`
   - **Duration**: empty (no expiry)
   - Click **Create New Key**. Copy the **keyID** and the **applicationKey**.
     The applicationKey is shown once.
3. The **read key**, for restores: the same again, with **Name of Key**
   `myapp-backup-reader` and **Type of Access** **Read Only**. Save it in your
   password manager. Not on the server.

Use application keys, not the account's master key: the master key doesn't
work with B2's S3 interface.

### Values

```bash
BACKUP_S3_BUCKET=myapp-backups
BACKUP_S3_ENDPOINT=https://s3.us-west-004.backblazeb2.com
BACKUP_S3_REGION=us-west-004
BACKUP_S3_ACCESS_KEY_ID=<writer keyID>
BACKUP_S3_SECRET_ACCESS_KEY=<writer applicationKey>
BACKUP_S3_PREFIX=myapp/
BACKUP_S3_KEEP_DAYS=0
```

## Option B: AWS S3

### The bucket

Create it as in [storage-s3-r2.md](./storage-s3-r2.md#create-the-bucket), with
the name `myapp-backups`, **all four Block Public Access boxes ticked**, SSE-S3
encryption, and **Bucket Versioning: Enable**. Versioning matters here: a
write-only key can still upload a file over an existing one, and with
versioning the old one survives.

### The lifecycle rules

Bucket → **Management** → **Create lifecycle rule**:

1. **Lifecycle rule name**: `expire-dumps`.
2. **Choose a rule scope**: **Limit the scope of this rule using one or more
   filters** → **Prefix**: `myapp/myapp_db/` (one rule per database).
3. **Lifecycle rule actions**, tick:
   - **Expire current versions of objects** → `30` days.
   - **Permanently delete noncurrent versions of objects** → `7` days.
   - **Delete expired object delete markers or incomplete multipart uploads**
     → **Delete incomplete multipart uploads** → `7` days. (The console won't
     combine "delete expired object delete markers" with the 30-day expiry in
     one rule; leave that box.)
4. **Create rule**.

Leave `myapp/uploads/` out of it, for the same reason as above.

### The writer: policy, user, key

1. IAM → **Policies** → **Create policy** → **JSON**, paste:

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Sid": "WriteBackupsOnly",
         "Effect": "Allow",
         "Action": ["s3:PutObject", "s3:AbortMultipartUpload"],
         "Resource": "arn:aws:s3:::myapp-backups/myapp/*"
       }
     ]
   }
   ```

   `s3:PutObject` covers ordinary uploads and the parts of a large one.
   `s3:AbortMultipartUpload` lets rclone clean up a large upload that failed
   half way. No list, no read, no delete. **Next** → name
   `myapp-backups-write` → **Create policy**.
2. IAM → **Users** → **Create user** `myapp-backup-writer`, no console access
   → **Attach policies directly** → `myapp-backups-write` → **Create user**.
3. The user → **Security credentials** → **Create access key** → **Other** →
   **Create access key**. Copy both values (shown once).

### The reader: policy, user, key

The same three steps with this policy, named `myapp-backups-read`, and a user
`myapp-backup-reader`. Save its key in your password manager, not on the
server.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ListBackups",
      "Effect": "Allow",
      "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::myapp-backups",
      "Condition": { "StringLike": { "s3:prefix": ["myapp/*"] } }
    },
    {
      "Sid": "ReadBackups",
      "Effect": "Allow",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::myapp-backups/myapp/*"
    }
  ]
}
```

### Values

```bash
BACKUP_S3_BUCKET=myapp-backups
# BACKUP_S3_ENDPOINT=                 # unset for AWS
BACKUP_S3_REGION=eu-central-1         # the bucket's region
BACKUP_S3_ACCESS_KEY_ID=<writer access key ID>
BACKUP_S3_SECRET_ACCESS_KEY=<writer secret>
BACKUP_S3_PREFIX=myapp/
BACKUP_S3_KEEP_DAYS=0
```

## Option C: Cloudflare R2

R2 has no write-only key. Its narrowest key, **Object Read & Write**, can also
read and delete. A **bucket lock rule** makes up for it: while a file is
locked, nobody can delete or overwrite it.

1. Create a bucket `myapp-backups` (see
   [storage-s3-r2.md](./storage-s3-r2.md#option-b-cloudflare-r2)), public access
   off.
2. The bucket → **Settings** → **Bucket Lock Rules** → **Add rule**: a name,
   **Prefix** `myapp/`, retention `30` days → **Save**.
3. The bucket → **Settings** → **Object Lifecycle Rules** → **Add rule**:
   **Prefix** `myapp/myapp_db/`, delete objects after `31` days (longer than
   the lock) → **Save**. If the labels differ, look for the rule that deletes
   objects a number of days after upload.
4. **Manage API tokens** → create a token with **Object Read & Write**,
   limited to `myapp-backups`. This is the server's key.
5. Create a second token with **Object Read only**, limited to the same
   bucket. This is the read key for your password manager. (The server's key
   can read too, but keep restores on a key the server never held.)
6. Once it runs, try to delete a dump with the server's key to confirm the
   lock holds. Cloudflare documents that a lock prevents deletion and
   overwriting, but not explicitly for every token type.

The downside stays: someone who takes over the server can **read** the dumps,
personal data included. If that matters to you, prefer B2 or S3.

```bash
BACKUP_S3_BUCKET=myapp-backups
BACKUP_S3_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
BACKUP_S3_REGION=auto
BACKUP_S3_ACCESS_KEY_ID=<Object Read & Write token's Access Key ID>
BACKUP_S3_SECRET_ACCESS_KEY=<its Secret Access Key>
BACKUP_S3_PREFIX=myapp/
BACKUP_S3_KEEP_DAYS=0
```

## Put the values in the env file

All in the **API's** `.env.production`, on the server
([.env.example](../../.env.example), [../backups.md](../backups.md#settings)):

| Variable | Value |
|---|---|
| `BACKUP_S3_BUCKET` | The bucket's name. Setting it turns the off-site copy on |
| `BACKUP_S3_ENDPOINT` | Unset for AWS. B2: `https://s3.<region>.backblazeb2.com`. R2: `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` |
| `BACKUP_S3_REGION` | AWS: the bucket's region. B2: e.g. `us-west-004`. R2: `auto` |
| `BACKUP_S3_ACCESS_KEY_ID` | The **write** key's ID |
| `BACKUP_S3_SECRET_ACCESS_KEY` | The **write** key's secret. **Secret** |
| `BACKUP_S3_PREFIX` | A folder in the bucket, e.g. `myapp/` (a missing trailing `/` is added) |
| `BACKUP_S3_KEEP_DAYS` | `0` with a key that can't delete. The default `30` makes each backup try to delete old dumps, and with a write-only key log a warning every night |

With `BACKUP_S3_BUCKET` set but a key missing, the backup service stops at
start with `BACKUP_S3_BUCKET is set, so BACKUP_S3_ACCESS_KEY_ID and
BACKUP_S3_SECRET_ACCESS_KEY are needed too`.

The change takes effect when the backup service is recreated: at the next
`./deploy.sh`, or now:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yaml up -d backup
```

Its first log line names the destination:

```bash
docker logs backup-hexagonal-auth-prod 2>&1 | tail -n 5
# ... Backing up myapp_db from db:5432 on '0 3 * * *' (UTC), copying to offsite:myapp-backups/myapp/
```

## Check it works

Run these on the server, in the API's folder. Don't wait for 3 a.m.

1. **Take a backup now:**

   ```bash
   docker compose --env-file .env.production -f docker-compose.prod.yaml exec backup backup.sh
   ```

   You should see `uploading to offsite:myapp-backups/myapp/myapp_db/` and no
   `WARNING` line. With the default `BACKUP_S3_KEEP_DAYS` and a write-only key
   you'd see `could not remove dumps older than 30 days ... (a key without
   delete permission?)`: set it to `0`.

2. **Look in the bucket** in the provider's web page: the dump is under
   `myapp/myapp_db/`.

3. **Prove the server's key can't read.** This should fail:

   ```bash
   docker compose --env-file .env.production -f docker-compose.prod.yaml exec backup restore.sh list --remote
   # ERROR: Could not list offsite:myapp-backups/myapp/myapp_db/. Restoring from the bucket needs a key that may list and read ...
   ```

   (With R2 it lists, since R2's key can read.)

4. **Prove the read key works, and the dump restores.** Pass the read key on
   the command line, so it is never saved on the server:

   ```bash
   docker compose --env-file .env.production -f docker-compose.prod.yaml run --rm \
     -e BACKUP_S3_ACCESS_KEY_ID=<read key id> -e BACKUP_S3_SECRET_ACCESS_KEY=<read key secret> \
     backup restore.sh verify myapp_db --remote
   ```

   This downloads the latest dump, restores it into a scratch database, prints
   its table count and latest migration, and drops it. Your live database is
   not touched. To keep the key out of your shell history, start the line
   with a space (most shells then skip it), or type `read -rs KEY` first and
   use `"$KEY"`.

5. **Watch it from now on.** The alerts `BackupUploadFailed` and
   `BackupUploadTooOld` fire when the copy stops working
   ([../alerts.md](../alerts.md)). Repeat step 4 every month or so: a backup
   you have never restored is only a hope.

## Common mistakes

| You see | Why | Fix |
|---|---|---|
| `could not remove dumps older than 30 days ... (a key without delete permission?)` every night | `BACKUP_S3_KEEP_DAYS` left at 30 with a write-only key | `BACKUP_S3_KEEP_DAYS=0`, and a lifecycle rule on the bucket |
| `upload of myapp_db/... failed; it is kept on this server`, `AccessDenied` | The key's prefix or policy doesn't cover `BACKUP_S3_PREFIX`, or the bucket name is wrong | Make the prefix in the key (B2), the policy's `Resource` (S3) and `BACKUP_S3_PREFIX` agree |
| Upload fails with a region or signature error | `BACKUP_S3_REGION` doesn't match the bucket's region (or isn't `auto` for R2) | Fix the region |
| `Could not list ... needs a key that may list and read` | You ran a restore with the server's write key | Pass the read key with `-e` as in step 4 |
| The lifecycle rule deleted uploaded files | The rule covered the whole prefix, `uploads/` included | Limit expiry rules to the database folders |
| Backups in the bucket, but at the same provider as the server | One account problem takes both | Move the bucket to another provider |
| The read key is in `.env.production` | Then the server can read and list everything, which the plan avoids | Remove it; keep it in the password manager |
| You lost `.env.production` with the server | The restored app needs the secrets the dumps go with (`JWT_SECRET`, the database password) | Keep a copy of `.env.production` in the password manager too |

Related: [../backups.md](../backups.md) (schedule, retention, restoring,
moving to a new server), [storage-s3-r2.md](./storage-s3-r2.md),
[prepare-for-production.md](./prepare-for-production.md).
