# Storage: an S3 or R2 bucket for avatars

The only files the API stores are profile pictures (avatars). By default they
go on the server's disk (`STORAGE_TYPE=local`, the `app-uploads` volume). This
page moves them to a **bucket**, an online folder at a storage provider, on
AWS S3 or Cloudflare R2: you create a private bucket and a key that may only
touch it, and put both in the `AWS_S3_*` variables.

You don't need it to start. Use a bucket when you run more than one API
server, when you'd rather not tie files to one machine's disk, or when you
expect many uploads. How the code handles files is in
[../file-uploads-and-s3.md](../file-uploads-and-s3.md).

| | |
|---|---|
| Needed in development | No. Local disk works; [RustFS](#development-rustfs) if you want to exercise the S3 code |
| Needed in production | No. Optional |
| Cost | R2: a free tier (10 GB stored a month at the time of writing), no charge for downloads. S3: pay per use, cents a month for avatars; check each provider's pricing page |
| Time | 20 minutes |
| You end with | `STORAGE_TYPE=s3` and `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_S3_BUCKET` (+ `AWS_S3_ENDPOINT` for R2) in `.env.production` |
| The web app needs | Nothing for an `https` bucket |

- [How the API uses the bucket](#how-the-api-uses-the-bucket)
- [Option A: AWS S3](#option-a-aws-s3)
- [Option B: Cloudflare R2](#option-b-cloudflare-r2)
- [Other S3-compatible providers](#other-s3-compatible-providers)
- [Development: RustFS](#development-rustfs)
- [The web app's Content-Security-Policy](#the-web-apps-content-security-policy)
- [Check it works](#check-it-works)
- [Moving from local storage](#moving-from-local-storage)
- [Common mistakes](#common-mistakes)

## How the API uses the bucket

Knowing this tells you which permissions the key needs, and why the bucket
stays private.

- **Uploads go through the API.** The web app sends the picture to
  `POST /api/v1/users/me/avatar`. The API checks it, resizes it to a WebP and
  writes it to the bucket as `avatars/avatar-<user id>-<time>-<random>.webp`.
  The browser never writes to the bucket, so the bucket needs **no CORS**
  settings.
- **The bucket is private.** Nobody can read a file by guessing its address.
  When the API returns a profile, it includes a **presigned URL**: a link to
  the file with a signature in it, made with the API's key, valid for one
  hour. The browser shows the picture with a plain `<img>`, which needs no
  CORS either.
- **Old pictures are deleted.** When someone uploads a new avatar or deletes
  their account, a background job deletes the old file.

The calls the code sends ([s3-storage.service.ts](../../src/shared/infrastructure/storage/services/s3-storage.service.ts)),
and the permission each needs:

| S3 call | When | IAM permission |
|---|---|---|
| `PutObject` | Every avatar upload | `s3:PutObject` |
| `GetObject` (signed into the avatar link) | Every profile the browser shows; the browser's request carries the API key's signature | `s3:GetObject` |
| `DeleteObject` | Replacing an avatar, deleting an account, undoing a failed upload | `s3:DeleteObject` |
| `HeadObject` | `fileExists()`, available to your own code | covered by `s3:GetObject` |

No listing, no copying, no bucket creation, no ACLs. A key that can do more
is a bigger loss if it leaks.

## Option A: AWS S3

### Create the bucket

1. Open <https://console.aws.amazon.com/s3/> and sign in.
2. Pick the **region** in the top bar: the one nearest your server, e.g.
   `eu-central-1`. A bucket's region can't change later. Note it.
3. Left menu → **General purpose buckets** → **Create bucket**.
4. If the form asks for a **Bucket namespace**, keep the default. If you pick
   the account-regional one, AWS adds a suffix to the name; use the full
   resulting name as `AWS_S3_BUCKET`.
5. **Bucket name**: e.g. `myapp-avatars-prod`. Lower-case letters, digits and
   hyphens; **no dots**. A dot breaks the HTTPS certificate on the
   `<bucket>.s3.<region>.amazonaws.com` address the API uses.
6. **Object Ownership**: **ACLs disabled (recommended)**, which means
   **Bucket owner enforced**.
7. **Block Public Access settings for this bucket**: leave **all four boxes
   ticked**. The API signs every link; nothing needs to be public.
8. **Bucket Versioning**: **Enable**. A deleted or replaced avatar can then be
   recovered (the [backup service](../backups.md) doesn't copy S3 buckets).
9. **Default encryption**: **Server-side encryption with Amazon S3 managed
   keys (SSE-S3)**.
10. Click **Create bucket**.
11. Optional, so old versions don't pile up: open the bucket → **Management**
    → **Create lifecycle rule** → name it `old-versions`, **Apply to all
    objects in the bucket** (tick the acknowledgement) → tick **Permanently
    delete noncurrent versions of objects** → **Days after objects become
    noncurrent**: `30` → **Create rule**.

No CORS rule and no bucket policy are needed.

### Create the policy (what the key may do)

1. Open the IAM console: <https://console.aws.amazon.com/iam/>.
2. Left menu → **Policies** → **Create policy**.
3. **Policy editor**: click **JSON**, delete what is there, and paste this,
   with your bucket's name in `Resource`:

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Sid": "AvatarObjects",
         "Effect": "Allow",
         "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
         "Resource": "arn:aws:s3:::myapp-avatars-prod/*"
       }
     ]
   }
   ```

4. Click **Next**. **Policy name**: `myapp-avatars-rw`. Click **Create
   policy**.

Notes on the policy:

- `/*` means "the objects in the bucket", not the bucket's own settings. The
  key can't delete the bucket, change its settings or list its files.
- Without `s3:ListBucket`, asking about a file that doesn't exist answers
  `403` instead of `404`. `fileExists()` returns `false` either way.
- To pin it to avatars only, use `arn:aws:s3:::myapp-avatars-prod/avatars/*`.
  A feature you add later that writes elsewhere would then get `AccessDenied`.
- Don't add `s3:*`, `s3:ListBucket` or `s3:PutObjectAcl`.

### Create the user and its access key

The API logs in to AWS as an **IAM user**: an identity with no password, only
the policy above and one access key.

1. IAM → **Users** → **Create user**.
2. **User name**: `myapp-avatars-app`. Leave **Provide user access to the AWS
   Management Console** unticked. Click **Next**.
3. **Permissions options**: **Attach policies directly**. Search for
   `myapp-avatars-rw`, tick it, click **Next**, then **Create user**.
4. Open the user → **Security credentials** tab → **Access keys** → **Create
   access key**.
5. **Use case**: choose **Other** (some consoles call it **Application
   running outside AWS**). AWS may suggest alternatives; for a server outside
   AWS, a key is the way. Click **Next**.
6. Optional description `myapp prod server`, then **Create access key**.
7. Copy the **Access key ID** (starts with `AKIA`) and the **Secret access
   key** (click **Show**), or **Download .csv file**. The secret is shown only
   now.

Never use the AWS account's root keys for this.

### Put the values in the env file

In the **API's** `.env.production`:

```bash
STORAGE_TYPE=s3
AWS_REGION=eu-central-1                 # the bucket's region, exactly
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
AWS_S3_BUCKET=myapp-avatars-prod
# Leave these three unset (or empty) for AWS:
# AWS_S3_ENDPOINT=
# AWS_S3_PUBLIC_ENDPOINT=
# AWS_S3_FORCE_PATH_STYLE=
```

With `STORAGE_TYPE=s3` the API refuses to start unless all four of `AWS_REGION`,
`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` and `AWS_S3_BUCKET` are set
([validation.ts](../../src/config/validation.ts)). Deploy with `./deploy.sh`.
Avatar links then look like
`https://myapp-avatars-prod.s3.eu-central-1.amazonaws.com/avatars/...?X-Amz-...`.

## Option B: Cloudflare R2

R2 speaks the S3 protocol, so the same code works; you add its address in
`AWS_S3_ENDPOINT`. Downloads are free, which suits images.

### Create the bucket

1. <https://dash.cloudflare.com> → **R2 Object Storage** in the sidebar (it
   may sit under **Storage & databases**). The first time, Cloudflare asks you
   to subscribe to R2; it may ask for a payment method even for the free tier.
2. Click **Create bucket**.
3. **Bucket name**: e.g. `myapp-avatars`. Lower-case letters, digits and
   hyphens, 3 to 63 characters.
4. **Location**: **Automatic** is fine. If you choose a jurisdiction such as
   the EU, the endpoint changes (see below).
5. **Default storage class**: **Standard**. Click **Create bucket**.
6. Leave public access **off**: don't enable the `r2.dev` address and don't
   connect a custom domain. Presigned links only work on R2's S3 address, and
   the bucket should stay private.

No CORS policy is needed.

### Create the API token (the key)

1. Back on the R2 overview page, find **API Tokens** (on the right, under
   **Account Details**, or in an **API** menu) and click **Manage**.
2. **Create Account API token** (or **Create User API token**; an account
   token survives you leaving the Cloudflare account).
3. **Token name**: `myapp-avatars-app`.
4. **Permissions**: **Object Read & Write**. R2 has no narrower write
   permission; that is fine here, since the API reads and deletes too.
5. **Specify bucket(s)**: **Apply to specific buckets only** → pick
   `myapp-avatars`. (If the wording differs, choose the option that limits the
   token to one bucket.)
6. **TTL**: **Forever**, or a date you will remember to renew. Optionally,
   under client IP filtering, allow only your server's IP.
7. Click **Create API Token**. Copy:
   - **Access Key ID**
   - **Secret Access Key**: "You will not be able to access your Secret Access
     Key again"
   - The S3 endpoint, `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`. Your
     account ID is also on the R2 overview page.

   The page also shows a **Token value**; the API doesn't use it.

### Put the values in the env file

In the **API's** `.env.production`:

```bash
STORAGE_TYPE=s3
AWS_REGION=auto
AWS_ACCESS_KEY_ID=...                   # R2 Access Key ID
AWS_SECRET_ACCESS_KEY=...               # R2 Secret Access Key
AWS_S3_BUCKET=myapp-avatars
AWS_S3_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
# EU jurisdiction: https://<ACCOUNT_ID>.eu.r2.cloudflarestorage.com
# Leave unset: links use the endpoint above, which browsers can reach too.
# AWS_S3_PUBLIC_ENDPOINT=
# Already on whenever an endpoint is set:
# AWS_S3_FORCE_PATH_STYLE=true
```

Avatar links then look like
`https://<ACCOUNT_ID>.r2.cloudflarestorage.com/myapp-avatars/avatars/...?X-Amz-...`.

You may read elsewhere that R2 refuses uploads from recent AWS SDKs
(`Header 'x-amz-checksum-crc32' ... not implemented`) and needs extra env
vars. Not here: with `AWS_S3_ENDPOINT` set, the API sends checksums only
where the S3 API requires them.

## Other S3-compatible providers

Backblaze B2, DigitalOcean Spaces, Wasabi and self-hosted servers work the
same way as R2:

- `AWS_S3_ENDPOINT`: the provider's S3 address, e.g.
  `https://s3.us-west-004.backblazeb2.com` or
  `https://fra1.digitaloceanspaces.com`.
- `AWS_REGION`: the provider's region name (`us-west-004`, `fra1`).
- A key limited to the one bucket, with read, write and delete.
- `AWS_S3_FORCE_PATH_STYLE` is on automatically with an endpoint; set it to
  `false` only if the provider asks for bucket-in-hostname addresses.

## Development: RustFS

To run the S3 code on your machine without an account, the dev stack has
**RustFS**, a local S3-compatible server. `pnpm test:services:up` starts it
and creates the bucket named in `AWS_S3_BUCKET`. In `.env.development`:

```bash
STORAGE_TYPE=s3
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=rustfsadmin
AWS_SECRET_ACCESS_KEY=rustfsadmin123
AWS_S3_BUCKET=avatars-dev
# The API in Docker (pnpm docker:dev) reaches RustFS by its service name,
# your browser by localhost:
AWS_S3_ENDPOINT=http://rustfs:9000
AWS_S3_PUBLIC_ENDPOINT=http://localhost:9100
# The API on your machine (pnpm start:dev) instead:
# AWS_S3_ENDPOINT=http://localhost:9100
```

`AWS_S3_PUBLIC_ENDPOINT` exists for this case: the API and the browser reach
storage at different addresses, and the address is part of a link's
signature, so links are signed for the browser's one. In production with S3 or
R2, leave it unset. The RustFS console is at
<http://localhost:9101/rustfs/console/> (`rustfsadmin` / `rustfsadmin123`).
The comments in [.env.example](../../.env.example) have the details.

## The web app's Content-Security-Policy

The React starter's production image sends a Content-Security-Policy (CSP), a
header that tells the browser where images may load from. It already allows
any `https://` image, so **an S3 or R2 bucket needs nothing**: leave the web
app's `CSP_IMG_SRC` empty.

Only a bucket served over plain `http` needs listing there. In practice that
is local RustFS while you try the web app's production image on your machine:
`CSP_IMG_SRC=http://localhost:9100` in the web app's env. The web app's dev
server sends no such header.

## Check it works

The easiest check: sign in on the web app, upload a profile picture, reload
the page. The picture should stay, and its address (right-click → **Open
image in new tab**) should be on your bucket's host.

The same with `curl`, against a confirmed account (`jq` pulls fields out of
the JSON; without it, read the output by eye):

```bash
API=https://api.example.com/api/v1

# 1. Sign in and keep the access token
TOKEN=$(curl -s -X POST $API/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","password":"your password"}' | jq -r .data.access_token)

# 2. Upload a picture (Idempotency-Key: any new UUID; uuidgen makes one)
curl -s -X POST $API/users/me/avatar \
  -H "Authorization: Bearer $TOKEN" \
  -H "Idempotency-Key: $(uuidgen)" \
  -F avatar=@photo.jpg | jq .data.avatar_url

# 3. Fetch the link it printed: expect 200 and content-type image/webp
curl -sI "<the avatar_url from step 2>"
```

Then look in the bucket (S3: the bucket's **Objects** tab; R2: the bucket's
page): there is an `avatars/` folder with the new file. Upload a second
picture; shortly after, the first file is gone (a background job deletes it).

If step 2 fails with a `500`, the API log says why:

```bash
docker logs nestapp-hexagonal-auth-prod 2>&1 | grep 'to S3'
# ... Failed to upload buffer to S3: Access Denied
```

## Moving from local storage

Switching `STORAGE_TYPE` doesn't move existing files. The database keeps each
avatar as a key like `avatars/avatar-...webp`, the same in both modes, so
avatars keep working if you copy the `avatars/` folder from the server's
`app-uploads` volume to the root of the bucket before switching. Otherwise
they show as broken images until people upload again.

## Common mistakes

| You see | Why | Fix |
|---|---|---|
| API won't start: `"AWS_S3_BUCKET" is required` (or another `AWS_*`) | `STORAGE_TYPE=s3` needs all four | Set region, key ID, secret and bucket |
| Upload fails: `Access Denied` | The policy's `Resource` names another bucket, or lacks `/*`; or the R2 token is scoped to another bucket | Fix the policy or token |
| Upload fails: `The bucket you are attempting to access must be addressed using the specified endpoint`, or a `PermanentRedirect` | `AWS_REGION` isn't the bucket's region | Set the bucket's region exactly |
| Upload works, but the picture is broken and its link answers `403` `SignatureDoesNotMatch` | The link was signed for an address the browser doesn't use, usually `AWS_S3_PUBLIC_ENDPOINT` set wrongly in production | Leave `AWS_S3_PUBLIC_ENDPOINT` unset for S3 and R2 |
| Link answers `403` `AccessDenied` after an hour | Links expire after one hour, by design | The web app fetches the profile again for a new link |
| R2: `Could not resolve host` or a TLS error | `AWS_S3_ENDPOINT` has the bucket name in it, or a typo in the account ID | `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`, no bucket, no path |
| S3: certificate error on the link | A dot in the bucket name | Create a bucket without dots |
| The bucket is public | Block Public Access turned off, or the R2 `r2.dev` address enabled | Turn them back; the API signs every link |
| Pictures broken in the web app only, with a CSP error in the browser console | A bucket over plain `http` not in the web app's `CSP_IMG_SRC` | Add it there (only for `http`; `https` is already allowed) |

Related: [../file-uploads-and-s3.md](../file-uploads-and-s3.md) (how the code
works), [../environment.md](../environment.md#uploads-and-storage),
[offsite-backups.md](./offsite-backups.md) (a bucket for database backups is a
different bucket, with a different key),
[prepare-for-production.md](./prepare-for-production.md).
