# Put Fileverse online for free — browser only

No software on your laptop, no payment. You will use four free websites:

| Service | What it does for Fileverse | Time |
|---|---|---|
| **GitHub** | stores the Fileverse code so your server can download it | 5 min |
| **DuckDNS** | gives you a free web address, e.g. `fileverse-kshitij.duckdns.org` | 3 min |
| **Oracle Cloud (Always Free)** | the free server that runs Fileverse 24/7 | 20 min + 30 min waiting |
| **Fileverse setup script** | installs everything automatically; you only paste it | — |

At the end, your site runs at `https://yourname.duckdns.org` with a padlock (HTTPS).

---

## Part A — GitHub (stores the code)

1. Go to **github.com** → **Sign up** (skip if you have an account).
2. Click **+** (top right) → **New repository**.
   - Repository name: `fileverse`
   - Select **Public** (the server downloads the code without a password).
   - Leave everything else unticked → **Create repository**.
3. Put the code in it — choose one:
   - **Easiest:** in claude.ai go to **Settings → Connectors → GitHub → Connect**, then tell Claude
     *"my repo is github.com/YOUR-USERNAME/fileverse"*. Claude uploads every file for you.
   - **Yourself:** on the new repository page click **uploading an existing file**, drag in the contents of
     the `fileverse` folder from the zip, then **Commit changes**.
4. Your repository address is `https://github.com/YOUR-USERNAME/fileverse.git` — you need it in Part C.

## Part B — DuckDNS (free web address)

1. Go to **duckdns.org** → sign in with Google or GitHub.
2. In **sub domain**, type a name (e.g. `fileverse-kshitij`) → **add domain**. Leave the IP as it is —
   the setup script fills it in automatically.
3. At the top of the page, copy your **token** (a long code like `a1b2c3d4-…`). Keep this page open.

## Part C — Oracle Cloud (the free server)

### C1. Create the account
1. Go to **oracle.com/cloud/free** → **Start for free**.
2. **Home region:** pick the one closest to you (for India: *India South (Hyderabad)* or
   *India West (Mumbai)*). It cannot be changed later.
3. Oracle asks for a card to verify your identity. Always Free resources are not charged.

### C2. Create a login key (inside the browser)
1. In the Oracle console, click the **Cloud Shell** icon (`>_`) at the top right and wait for the terminal.
2. Paste this and press Enter:
   ```
   ssh-keygen -t ed25519 -N "" -f ~/.ssh/id_ed25519 <<< y >/dev/null; cat ~/.ssh/id_ed25519.pub
   ```
3. Copy the line it prints (starts with `ssh-ed25519`). You will paste it in the next step.
   (This lets you look at your server later, from the browser.)

### C3. Create the server
Menu (☰) → **Compute → Instances → Create instance**.

| Setting | Choose |
|---|---|
| Name | `fileverse` |
| Image | **Change image → Ubuntu → Canonical Ubuntu 24.04** (not "Minimal") |
| Shape | **Change shape → Ampere → VM.Standard.A1.Flex**, **2 OCPUs** and **12 GB memory** (the free maximum — don't go higher) |
| Networking | **Create new virtual cloud network** and **public subnet**; **Assign a public IPv4 address: Yes** |
| SSH keys | **Paste public keys** → paste the line from C2 |
| Boot volume | **Specify a custom boot volume size → 200 GB** (free maximum; space for big videos) |
| Advanced options → **Management** → Initialization script | **Paste cloud-init script** → paste the script below, with your three values filled in |

The script (also in this repository at `deploy/oracle-setup.sh`) — change only the first three values:

```bash
DUCKDNS_SUBDOMAIN="your-subdomain"          # e.g. fileverse-kshitij   (without .duckdns.org)
DUCKDNS_TOKEN="your-duckdns-token"          # from the top of duckdns.org
GITHUB_REPO="https://github.com/your-username/fileverse.git"
```

Click **Create**.

> **"Out of capacity for shape VM.Standard.A1.Flex"?** Free Arm servers are popular. Change the
> **Availability domain** (AD-2, AD-3) if your region has several, or try again an hour later.

### C4. Open the web ports
1. On your instance page, click the **Subnet** link (under *Primary VNIC*).
2. Open **Security → Default Security List** (older console: *Security Lists*).
3. **Add Ingress Rules**:
   - Source CIDR: `0.0.0.0/0`
   - IP Protocol: `TCP`
   - Destination Port Range: `80,443`
   - **Add Ingress Rules**.

### C5. Wait, then open your site
The script now installs Docker and every conversion engine and starts Fileverse. This takes about
**25–35 minutes** the first time. Then open:

**`https://YOUR-SUBDOMAIN.duckdns.org`**

The first visit may take a few extra seconds while the HTTPS certificate is issued.

---

## Checking on it (optional, in the browser)

Open **Cloud Shell** again and run (replace the IP with your instance's *Public IP address*):

```
ssh ubuntu@PUBLIC_IP 'sudo tail -n 15 /var/log/fileverse-setup.log'
```

The last line says **"Fileverse setup finished"** when it is done.

| Problem | Fix |
|---|---|
| Log shows `DuckDNS update: KO` | The token was mistyped. On duckdns.org, type your instance's **Public IP address** into the *current ip* box next to your subdomain and click **update ip**. The site starts working within minutes. |
| The subdomain in the script was mistyped | Easiest fix: **Terminate** the instance (tick *delete boot volume*) and create it again with the corrected script. |
| Site doesn't open after 40 min | Check C4 (ports 80 and 443). Then `ssh ubuntu@PUBLIC_IP 'cd /opt/fileverse && sudo docker compose ps'` — both services should be *running*. |
| Browser warns about the certificate | Wait 2–3 minutes after the site first answers; the certificate is issued automatically. |

## Updating later

After new code is in your GitHub repository, open Cloud Shell and run:
```
ssh ubuntu@PUBLIC_IP 'sudo fileverse-update'
```

## Staying free

- Keep the server at **2 OCPUs / 12 GB** and the total storage at **200 GB** or less. These are
  Oracle's current Always Free limits (halved in 2026 from the 4 OCPU / 24 GB still quoted in older
  guides).
- Files are deleted automatically 2 hours after conversion, so the disk does not fill up.
- What to expect from a 2-core server: format changes that copy the original streams (MKV→MP4,
  MOV→MP4, MP4→M4A…) take seconds even for 6 GB; full re-encodes of long HD videos take roughly as long
  as the video plays. Images, PDFs and documents take seconds.
