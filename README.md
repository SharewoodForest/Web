# Sharewood Forest — Website

Static site for sharewoodforest.app. No build step: plain HTML, CSS and JavaScript (ethers v6 from CDN).

- `index.html` — landing page and send flow
- `claim/index.html` — claim page (`/claim/#<giftId>.<claimKey>.<note>`)
- `assets/config.js` — network, contract address and token list. **Edit this after deploying the contract.**

The claim key lives after `#`, so it is never sent to any server.

Hosted on GitHub Pages from `main`.
