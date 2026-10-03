# ring-nas-recorder

Saves Ring camera video to a NAS folder **without a Ring Protect subscription**.

Without Ring Protect, Ring does not store any recordings in its cloud, so there is
nothing to download. Instead this container listens for the same motion / doorbell
push notifications the Ring app receives, opens a live stream the moment one arrives,
and records it to MP4 with ffmpeg:

```
/recordings/
  Front Door/
    2026-10-03/
      2026-10-03_07-05-09_motion.mp4
      2026-10-03_07-12-44_ding.mp4
  Back Yard/
    2026-10-03/
      2026-10-03_22-00-00_continuous.mp4
```

It is built on [`ring-client-api`](https://github.com/dgreif/ring) (the library used by
homebridge-ring and ring-mqtt), runs as a single small container, and has no other
dependencies (no MQTT broker, Home Assistant or NVR).

## Read this first: limitations of live-stream recording

| Caveat | Why |
| --- | --- |
| Clips start roughly 3-8 seconds after motion | The notification has to reach the container and a live session has to be negotiated. Only Ring Protect gives you pre-roll. |
| Battery cameras drain faster | Each clip is a live-view session. Keep `CLIP_SECONDS` modest, and leave battery cameras out of continuous mode. |
| No new motion alerts while a stream is live | Ring cameras don't send motion notifications during live view, so one clip covers one event and the camera re-arms after `COOLDOWN_SECONDS`. |
| Concurrent streams are limited | Ring may refuse or drop parallel live sessions on one account. `MAX_CONCURRENT_STREAMS` (default 2) skips extra events instead of piling up sessions. |
| Live sessions last at most about 10 minutes | Ring ends them, so continuous mode records segments of `SEGMENT_SECONDS` (590 or less) with a gap of a few seconds between them. |
| Some settings block third-party streaming | Ring **End-to-End Encryption** must be off. **Modes** that disable Live View for a camera also block recording. **Motion Alerts** must be on for each camera (Ring app > Device > Motion Settings), otherwise no notifications reach the container. |
| Internet required | All Ring streaming goes through Ring's cloud, even when the NAS sits next to the camera. |

## Configuration

All settings are environment variables.

| Variable | Default | Description |
| --- | --- | --- |
| `RING_REFRESH_TOKEN` | – | Token from the auth step. Read **only** while `/data/refresh-token` doesn't exist yet. |
| `TZ` | UTC | Time zone for folder and file names, e.g. `America/Chicago`. |
| `PUID` / `PGID` | `568` / `568` | User and group the recorder runs as. 568 is TrueNAS's `apps` user. |
| `CAMERAS` | all | Comma-separated camera names (as in the Ring app, case-insensitive) or ids. |
| `TRIGGERS` | `motion,ding` | What starts a clip: `motion`, `ding` (doorbells only), or both. Set it to an empty string for continuous-only mode. |
| `CLIP_SECONDS` | `45` | Length of each event clip (5-600). |
| `COOLDOWN_SECONDS` | `15` | Ignore new events for this long after a clip on the same camera. |
| `MAX_CONCURRENT_STREAMS` | `2` | Maximum number of simultaneous live sessions across all cameras. |
| `CONTINUOUS_CAMERAS` | – | Cameras to record continuously while `CONTINUOUS_SCHEDULE` is active. |
| `CONTINUOUS_SCHEDULE` | `off` | `off`, `always`, or windows such as `22:00-06:00,12:00-13:00`. Event triggers are paused for those cameras while the window is active. |
| `SEGMENT_SECONDS` | `300` | Length of each continuous segment (30-590). |
| `RETENTION_DAYS` | `0` | Delete `.mp4` files older than N days. `0` keeps everything. |
| `MIN_CLIP_BYTES` | `50000` | Discard clips smaller than this (failed or refused streams). |
| `DRY_RUN` | `false` | Log what would be recorded without opening streams. |
| `DEBUG` | `false` | Verbose logging, including from `ring-client-api`. |
| `MOCK` | `false` | Use two simulated cameras and ffmpeg test video instead of Ring. |

Volumes:

- `/data` holds app state: the rotated refresh token (`refresh-token`, mode 600) and a heartbeat file used by the healthcheck. Keep this on persistent storage, because **losing it means generating a new token**.
- `/recordings` is where the MP4 files go.

### Why the token file matters

Ring refresh tokens are single-use. Every time the container authenticates, Ring
issues a new token, and the old one stops working soon after. The token also carries
the push-notification registration. The container writes each new token to
`/data/refresh-token` and prefers that file over `RING_REFRESH_TOKEN`. So you only
paste a token once, and an old token left in the YAML is harmless. If the log ever
shows `Refresh token is not valid`, generate a new one with the auth step and delete
`/data/refresh-token`.

---

## Deploying on TrueNAS SCALE 25.10 (primary)

These steps target TrueNAS SCALE **25.10 (Goldeye)**, whose apps run on Docker. The
steps use pool name `tank`; replace it with your pool name.

### 1. Create the datasets

**Datasets > Add Dataset**:

1. Create `tank/apps/ring-nas-recorder` with **Dataset Preset: Apps**. It will hold
   the token and state (it becomes `/data`). Create `tank/apps` first if you don't
   have it.
2. Create the recordings dataset, e.g. `tank/media/ring` (it becomes `/recordings`).
   Use **Preset: SMB** if you want to browse the clips from a PC through an SMB
   share, otherwise **Generic**.

### 2. Give the `apps` user (UID/GID 568) write access

The container runs as 568:568. It refuses to start, with a clear error in the log,
if it cannot write to `/recordings`.

- **Recordings dataset**: select `tank/media/ring` > **Permissions > Edit**.
  - NFSv4 ACL (the SMB preset): **Add Item**, Who = User, User = `apps`,
    Permissions = **Modify**. Tick **Apply permissions recursively**, then
    **Save Access Control List**. Your own SMB user keeps its access, so you can
    still browse and delete clips over the share.
  - POSIX / Generic: set Owner User = `apps` and Owner Group = `apps`, tick
    **Apply User / Apply Group / Apply recursively**, then Save.
- **App dataset**: the Apps preset already grants `apps` access. The container also
  `chown`s `/data` to 568 on startup. It never `chown`s `/recordings`, so your ACLs
  stay intact.

### 3. Build the image

Open **System > Shell**, or SSH in as your admin user and prefix the commands with
`sudo`:

```sh
mkdir -p /mnt/tank/apps/ring-nas-recorder/build && cd /mnt/tank/apps/ring-nas-recorder/build
curl -L https://github.com/wakeupworld/Swift/archive/refs/heads/cursor/ring-nas-recorder-088d.tar.gz \
  | tar xz --strip-components=1 --wildcards '*/ring-nas-recorder/'
sudo docker build -t ring-nas-recorder:latest ./ring-nas-recorder
```

After this PR is merged, use `.../archive/refs/heads/master.tar.gz` instead. The
image is local, so the app YAML uses `pull_policy: never`.

### 4. Generate a refresh token (one time)

```sh
sudo docker run --rm -it ring-nas-recorder:latest auth
```

Enter your Ring email, password and the 2FA code Ring sends you, then copy the long
token it prints. After the first run, **Ring app > Control Center > Authorized Client
Devices** shows `ring-nas-recorder`, which is how you revoke it later.

### 5. Install the app via YAML

1. Go to **Apps > Discover Apps**, click the **⋮** menu at the top right, and
   choose **Install via YAML**.
2. Name it `ring-nas-recorder` and paste
   [`deploy/truenas-app.yaml`](deploy/truenas-app.yaml):

   ```yaml
   services:
     ring-nas-recorder:
       image: ring-nas-recorder:latest
       pull_policy: never
       restart: unless-stopped
       environment:
         TZ: America/New_York
         PUID: "568"
         PGID: "568"
         RING_REFRESH_TOKEN: "paste-token-from-auth-step"
         TRIGGERS: motion,ding
         CLIP_SECONDS: "45"
         MAX_CONCURRENT_STREAMS: "2"
         RETENTION_DAYS: "30"
       volumes:
         - /mnt/tank/apps/ring-nas-recorder/data:/data
         - /mnt/tank/media/ring:/recordings
   ```

3. Fix the `/mnt/...` paths, `TZ`, and the token, then click **Save**.

`restart: unless-stopped` brings the recorder back after crashes and NAS reboots
(TrueNAS restarts apps when the Docker service starts). The image healthcheck marks
the app unhealthy if the heartbeat stops for 3 minutes.

### 6. Verify

Open **Apps > Installed > ring-nas-recorder > Logs**. You should see:

```
INFO  Using refresh token from RING_REFRESH_TOKEN (first run)
INFO  Authenticating with Ring and discovering cameras...
INFO  Refresh token rotated and saved
INFO  Camera "Front Door" (id 123456) battery, triggers: motion+ding
INFO  Listening for events: 45s clips -> /recordings
```

Walk in front of a camera. About a minute later a file appears in
`/mnt/tank/media/ring/<Camera>/<date>/`. From then on, `data/refresh-token` holds the
live token. You can blank out `RING_REFRESH_TOKEN` with **Edit** if you prefer not to
keep the old token in the app config.

### Updating

Rebuild the image (step 3), then open the app and choose **Edit > Save** (or Stop,
then Start) so the container is recreated from the new image. The token and state in
`/data` are kept.

### Optional: write the clips to a Synology share instead

The container can run on TrueNAS while the files land on a Synology NAS. Swap the
`/recordings` bind mount for a Docker NFS or SMB volume in the YAML.

**NFS (recommended).** On the Synology, enable NFS under **Control Panel > File
Services > NFS**. Then open the shared folder's **Edit > NFS Permissions** and add the
TrueNAS IP with Read/Write and *Squash: Map all users to admin*. If you'd rather not
squash, make the folder writable by UID 568 instead.

```yaml
services:
  ring-nas-recorder:
    # ...same as above, but:
    volumes:
      - /mnt/tank/apps/ring-nas-recorder/data:/data
      - synology-ring:/recordings
volumes:
  synology-ring:
    driver: local
    driver_opts:
      type: nfs
      o: addr=192.168.1.20,nfsvers=4.1,rw,soft
      device: ":/volume1/ring"
```

**SMB.** Create a DSM user with write access to the share, then:

```yaml
volumes:
  synology-ring:
    driver: local
    driver_opts:
      type: cifs
      o: "username=ringrec,password=CHANGE_ME,uid=568,gid=568,vers=3.0,file_mode=0664,dir_mode=0775"
      device: "//192.168.1.20/ring"
```

Keep `/data` on a local TrueNAS dataset either way, so the token survives if the
Synology is offline. If the share is unreachable at startup, the container fails and
`restart: unless-stopped` keeps retrying.

To run the container **on** a Synology instead, use **Container Manager > Project >
Create** with [`docker-compose.yml`](docker-compose.yml). Set `PUID`/`PGID` to your
DSM user's ids (run `id <user>` over SSH) and bind-mount a shared folder such as
`/volume1/ring:/recordings`.

---

## Any other Docker host

```sh
cp .env.example .env            # add RING_REFRESH_TOKEN, TZ, PUID/PGID
docker compose build
docker compose run --rm ring-nas-recorder auth   # if you still need a token
docker compose up -d
docker compose logs -f
```

## Testing without a Ring account

```sh
docker build -t ring-nas-recorder .
mkdir -p rec && sudo chown 568:568 rec
docker run --rm -e MOCK=1 -e RING_REFRESH_TOKEN=x -e CLIP_SECONDS=8 \
  -e MOCK_EVENT_INTERVAL_SECONDS=5 -e EXIT_AFTER_SECONDS=40 \
  -v "$PWD/rec:/recordings" ring-nas-recorder
```

Mock mode simulates a doorbell and a camera. It runs the real recording, folder
layout, token-persistence and permission code paths, with ffmpeg test video standing
in for the Ring stream. Unit tests run with `npm test`.

## Alternatives considered

- **ring-mqtt** (+ go2rtc / Frigate) exposes each Ring camera as an RTSP stream. It is
  a good fit if you already run Home Assistant or MQTT. Recording clips still needs
  an automation that starts ffmpeg on motion, though. Frigate needs a continuous
  stream, which disables Ring motion alerts, drains batteries, and gets cut every
  10 minutes.
- **Scrypted** (Ring plugin + Scrypted NVR) offers a polished NVR UI and HomeKit
  integration. It is much heavier, the NVR is a paid add-on, and continuous
  recording has the same Ring streaming limits.
- **Recorded-event downloaders** (`camera.getEvents()` / `getRecordingUrl()`) need
  Ring Protect, so they don't apply here.
