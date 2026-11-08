/* ==========================================================================
   agent-wallet.js

   The resale module reordered into a four-step wallet - log in, choose a role,
   use the wallet, browse the registry - that a person or an AI agent can
   drive. Every action is published as a WebMCP tool (navigator.modelContext),
   and the tools call the same functions as the buttons, so whatever an agent
   does shows up on screen exactly as if the person had done it.

   Anything that signs a qBESU transaction asks the person first, in the page.
   ========================================================================== */

(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const PROFILES = ['alice', 'bob'];
  // Alice works in the China GBA (blue), Bob in Hong Kong (orange). Either can
  // be the artist or the collector; the region follows the person, not the role.
  const PEOPLE = {
    alice: { name: 'Alice', initial: 'A', region: { key: 'gba', name: 'China GBA' } },
    bob:   { name: 'Bob',   initial: 'B', region: { key: 'hk',  name: 'Hong Kong' } }
  };
  const ROLES = {
    artist:    { label: 'Artist',    wallet: 'Artist wallet' },
    collector: { label: 'Collector', wallet: 'Collector wallet' }
  };
  const PAGES = ['login', 'role', 'wallet', 'registry'];
  const PAGE_TITLE = { login: 'Human Principal', role: 'Bound Agent', wallet: 'Wallet Mandate', registry: 'Settlement Registry' };

  const state = {
    page: 'login',
    user: null,           // 'alice' | 'bob' once unlocked
    role: null,           // 'artist' | 'collector'
    account: null,        // the logged-in wallet's chain record
    known: {},            // profile -> address seen this session (addresses are public)
    collectors: [],
    artworks: [],
    ledger: [],
    synced: false,
    busy: null,           // label of the transaction being confirmed
    // seller
    selected: null,
    price: 1500,
    lightening: 70,
    // Payment codes carry only an address, so the artwork and price are held
    // here against it - standing in for a registry/backend lookup, as in the
    // resale module. Kept across log-outs so the other account can buy.
    listings: new Map(),  // seller address (lower case) -> { seller, address, amount, art }
    // buyer
    scanned: null,
    stage: 'idle',        // idle | scanned | paid | transferring | transferFailed | transferred
    channel: 'chain',
    payRef: null,
    txHash: null,
    hideUnlisted: true
  };

  const isConnected = profile => ArtIDChain.isConnected(profile);
  const person = profile => PEOPLE[profile] || null;
  const piece = id => state.artworks.find(p => p.id === id);
  const sameAddress = (a, b) => Boolean(a && b) && a.toLowerCase() === b.toLowerCase();
  const shorten = a => a ? a.slice(0, 10) + '…' + a.slice(-6) : '—';
  const escapeHtml = value => String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[ch]);
  const fmt = n => new Intl.NumberFormat('en-HK', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
  const rndHex = n => '0x' + Array.from({ length: n }, () => '0123456789abcdef'[Math.random() * 16 | 0]).join('');
  const rndAuth = () => Array.from({ length: 6 }, () => '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.random() * 34 | 0]).join('');

  const CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
  const ICON_ART = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="m3 16 5-5 4 4 3-3 6 6"/><circle cx="9" cy="8.5" r="1.5"/></svg>';
  const ICON_VERIFIED = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 5 6v5c0 4.5 3 8.4 7 10 4-1.6 7-5.5 7-10V6l-7-3Z"/><path d="m9 12 2 2 4-4"/></svg>';

  /* ---------------- shared helpers ---------------- */

  function transactionLink(hash, label) {
    if (!hash || !/^0x[a-fA-F0-9]{64}$/.test(hash)) return '—';
    const url = 'https://quantumbesu.web.app/quantumbesu.html?transaction=' + encodeURIComponent(hash);
    return `<a href="${url}" target="_blank" rel="noopener noreferrer">${escapeHtml(label || shorten(hash))}</a>`;
  }

  function displayImageUrl(uri) {
    const match = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/i.exec(uri || '');
    return match
      ? 'https://raw.githubusercontent.com/' + match[1] + '/' + match[2] + '/' + match[3] + '/' + match[4]
      : uri;
  }

  function artImage(p, className) {
    return `<img class="${className}" src="${escapeHtml(displayImageUrl(p.imageURI))}" alt="${escapeHtml(p.title)}" loading="lazy">`;
  }

  function emptyState(message) {
    return `<div class="rs-empty">${ICON_ART}<span>${message}</span></div>`;
  }

  function step(n, title, sub, complete, current) {
    return `<div class="rs-step ${complete ? 'done' : current ? 'active' : ''}"${current && !complete ? ' aria-current="step"' : ''}>
      <span class="rs-step-dot">${complete ? CHECK : n}</span>
      <span class="rs-step-text"><b>${title}</b><em>${sub}</em></span>
    </div>`;
  }

  function profileForAddress(address) {
    return PROFILES.find(profile => sameAddress(state.known[profile], address)) || null;
  }

  /* Known by address once a wallet has been unlocked this session, otherwise by
     the registered display name, so the public view still knows who is who. */
  function personForAddress(address) {
    const profile = profileForAddress(address);
    if (profile) return profile;
    const collector = state.collectors.find(item => sameAddress(item.address, address));
    const name = collector && collector.displayName || '';
    return /\balice\b/i.test(name) ? 'alice' : /\bbob\b/i.test(name) ? 'bob' : null;
  }

  function regionForAddress(address) {
    const profile = personForAddress(address);
    return profile ? PEOPLE[profile].region : null;
  }

  // Roles are interchangeable, so the demo wallets go by the person's name
  // rather than the "Artist Alice" / "Collector Bob" registered display names.
  function ownerLabel(address) {
    if (!address) return '—';
    const profile = personForAddress(address);
    if (profile) return PEOPLE[profile].name;
    const collector = state.collectors.find(item => sameAddress(item.address, address));
    return collector && collector.displayName ? collector.displayName : shorten(address);
  }

  function partyChip(address) {
    const region = regionForAddress(address);
    return `<span class="rs-party ${region ? 'rs-region-' + region.key : ''}" title="${escapeHtml(address)}">
      <span class="rs-party-dot" aria-hidden="true"></span>${escapeHtml(ownerLabel(address))}${region ? `<em>${region.name}</em>` : ''}</span>`;
  }

  let statusTimer = null;

  function showChainStatus(message, type, txHash) {
    const status = $('chainStatus');
    const kind = ['error', 'success', 'pending'].includes(type) ? type : 'info';
    // errors and pending transactions stay until dismissed or replaced
    clearTimeout(statusTimer);
    if (kind === 'info' || kind === 'success') {
      statusTimer = setTimeout(() => { status.hidden = true; }, kind === 'info' ? 4000 : 8000);
    }
    status.className = 'rs-chain-status ' + kind;
    status.replaceChildren();
    status.hidden = false;
    status.style.animation = 'none';
    void status.offsetWidth;
    status.style.animation = '';
    const icon = document.createElement('span');
    icon.className = kind === 'pending' ? 'rs-chain-spinner' : 'rs-chain-icon';
    icon.setAttribute('aria-hidden', 'true');
    if (kind === 'success') icon.innerHTML = CHECK;
    if (kind === 'error') icon.textContent = '!';
    if (kind === 'info') icon.textContent = 'i';
    status.appendChild(icon);
    const body = document.createElement('span');
    body.className = 'rs-chain-text';
    const text = document.createElement('span');
    text.textContent = message;
    body.appendChild(text);
    if (txHash) {
      const link = document.createElement('a');
      link.href = 'https://quantumbesu.web.app/quantumbesu.html?transaction=' + encodeURIComponent(txHash);
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.title = txHash;
      link.textContent = 'Transaction ' + shorten(txHash);
      body.appendChild(link);
    }
    status.appendChild(body);
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'rs-chain-close';
    close.setAttribute('aria-label', 'Dismiss');
    close.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
    close.addEventListener('click', () => { status.hidden = true; });
    status.appendChild(close);
  }

  function markSynced(ok) {
    const el = $('syncState');
    const dot = document.createElement('span');
    dot.className = 'rs-portal-status-icon' + (ok ? ' is-unlocked' : ' is-error');
    dot.setAttribute('aria-hidden', 'true');
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    el.replaceChildren(dot, document.createTextNode(ok ? 'Registry in sync · ' + time : 'Registry sync failed · it will retry after log in'));
  }

  /* ---------------- pages ---------------- */

  function canOpen(page) {
    if (page === 'login') return !state.user;
    if (page === 'role' || page === 'registry') return Boolean(state.user);
    if (page === 'wallet') return Boolean(state.user && state.role);
    return false;
  }

  function go(page, options) {
    if (!PAGES.includes(page)) throw new Error('Unknown page "' + page + '".');
    if (!canOpen(page)) {
      throw new Error(page === 'wallet' && state.user
        ? 'Choose a role first.'
        : page === 'login' ? 'Log out first.' : 'Log in first.');
    }
    state.page = page;
    PAGES.forEach(name => { $(name + 'Page').hidden = name !== page; });
    document.title = PAGE_TITLE[page] + ' · DID:ART ID Registry (GBA-HK)';
    window.scrollTo({ top: 0 });
    renderChrome();
    renderPage();
    publishTools();
    // move focus to the new page's heading so screen readers announce it
    if (!options || options.focus !== false) {
      const heading = $(page + 'Page').querySelector('h1');
      if (heading) heading.focus({ preventScroll: true });
    }
  }

  function renderChrome() {
    const index = PAGES.indexOf(state.page);
    document.querySelectorAll('[data-step]').forEach(button => {
      const page = button.dataset.step;
      const i = PAGES.indexOf(page);
      button.disabled = page !== state.page && !canOpen(page);
      button.classList.toggle('is-done', i < index || (page === 'login' && Boolean(state.user)));
      if (page === state.page) button.setAttribute('aria-current', 'step');
      else button.removeAttribute('aria-current');
    });
    $('logoutBtn').hidden = !state.user;
    $('brandSub').textContent = state.user
      ? 'Agentic ' + PEOPLE[state.user].name + (state.role ? ' · ' + ROLES[state.role].label : '') + ' · Agent Wallet'
      : 'Cross-border transactions · Human & Agent · Artist to Collector';
  }

  function renderPage() {
    if (state.page === 'login') {
      PROFILES.forEach(profile => {
        const account = state.collectors.find(item => sameAddress(item.address, state.known[profile]));
        $(profile + 'PrincipalDid').textContent = account && account.registered
          ? account.did
          : state.known[profile] ? 'Collector DID not registered' : 'DID available after unlock';
      });
    }
    if (state.page === 'role') renderRolePage();
    if (state.page === 'wallet') renderWallet();
    if (state.page === 'registry') { renderRegistry(); renderLedger(); }
  }

  function renderRolePage() {
    $('roleHeading').textContent = 'Agentic ' + PEOPLE[state.user].name + ' · choose a role';
    $('roleWalletAddress').textContent = state.account ? state.account.address : 'Unavailable';
    $('roleWalletDid').textContent = state.account
      ? state.account.did || 'Not registered'
      : 'Unavailable';
    document.querySelectorAll('[data-role]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.role === state.role));
    });
  }

  /* ---------------- session ---------------- */

  async function logIn(profile, pin) {
    if (!PROFILES.includes(profile)) throw new Error('Choose Alice or Bob.');
    if (!String(pin || '').trim()) throw new Error('Enter the wallet PIN.');
    if (state.user && state.user !== profile) logOut({ quiet: true });
    $('loginBtn').disabled = true;
    $('loginBtn').textContent = 'Unlocking…';
    try {
      const session = await ArtIDChain.connect(profile, pin);
      state.user = profile;
      state.known[profile] = session.address;
      state.role = null;
      await refreshChainState();
      $('pinInput').value = '';
      go('role');
      showChainStatus(PEOPLE[profile].name + ' unlocked and connected to qBESU.', 'success');
      return { account: profile, address: session.address };
    } catch (error) {
      ArtIDChain.lock(profile);
      state.user = null;
      state.account = null;
      throw error;
    } finally {
      $('loginBtn').disabled = false;
      $('loginBtn').textContent = 'Unlock wallet';
    }
  }

  function logOut(options) {
    if (state.busy) throw new Error('Wait for the pending transaction to confirm before logging out.');
    const name = state.user && PEOPLE[state.user].name;
    if (state.user) ArtIDChain.lock(state.user);
    state.user = null;
    state.role = null;
    state.account = null;
    state.selected = null;
    resetPurchase();
    ['agentMandateId', 'agentMandateArtwork', 'agentMandateStatus'].forEach(id => {
      if (id === 'agentMandateStatus') { $(id).textContent = ''; return; }
      $(id).value = '';
    });
    if (!options || !options.quiet) {
      go('login');
      if (name) showChainStatus(name + ' logged out. The wallet PIN has been cleared from this session.', 'success');
    }
  }

  function selectRole(role) {
    if (!ROLES[role]) throw new Error('Choose artist or collector.');
    if (!state.user) throw new Error('Log in first.');
    state.role = role;
    go('wallet');
  }

  /* ---------------- chain state ---------------- */

  async function refreshChainState() {
    const [health, collectorResponse, artworkResponse, ledgerResponse] = await Promise.all([
      ArtIDChain.health(),
      ArtIDChain.collectors(),
      ArtIDChain.artworks(),
      ArtIDChain.ledger()
    ]);
    if (health.chainId !== Number(ARTID_CONFIG.chainId)) {
      throw new Error('Connected network does not match the configured qBESU network.');
    }
    state.collectors = collectorResponse.collectors;
    state.account = null;
    if (state.user && isConnected(state.user)) {
      const account = await ArtIDChain.wallet(state.user);
      const record = state.collectors.find(item => sameAddress(item.address, account.address));
      state.account = Object.assign(account, record || {});
      state.known[state.user] = account.address;
    }
    state.artworks = artworkResponse.artworks.map(art => Object.assign({}, art, {
      id: art.artworkId,
      erc721: art.address
    }));
    state.ledger = ledgerResponse.transfers;
    const latestTransfer = new Map();
    state.ledger.forEach(transfer => {
      if (!latestTransfer.has(transfer.artwork.toLowerCase())) {
        latestTransfer.set(transfer.artwork.toLowerCase(), transfer.transactionHash);
      }
    });
    state.artworks.forEach(artwork => {
      artwork.transferTxHash = latestTransfer.get(artwork.erc721.toLowerCase()) || null;
    });
    // a listing only stands while its seller still owns the listed work
    for (const [address, listing] of state.listings) {
      const art = piece(listing.art);
      if (!art || !art.listed || !sameAddress(art.owner, listing.address)) state.listings.delete(address);
    }
    if (state.selected) {
      const current = piece(state.selected.id);
      state.selected = current && current.listed && state.account && sameAddress(current.owner, state.account.address)
        ? current : null;
    }
    state.synced = true;
    markSynced(true);
    renderPage();
  }

  async function refreshRegistry() {
    const button = $('refreshChainBtn');
    button.disabled = true;
    showChainStatus('Loading registry data from qBESU.', 'pending');
    try {
      await refreshChainState();
      showChainStatus('Registry data loaded from qBESU.', 'success');
    } catch (error) {
      markSynced(false);
      showChainStatus('Could not load registry data: ' + error.message, 'error');
      throw error;
    } finally {
      button.disabled = false;
    }
  }

  /* Submit a signed transaction, wait for its block, then re-read the chain.
     The one path every wallet write goes through. */
  async function chainWrite(label, send) {
    if (state.busy) throw new Error('Another transaction is still confirming: ' + state.busy + '.');
    state.busy = label;
    renderPage();
    let txHash = null;
    let confirmed = false;
    try {
      txHash = (await send()).txHash;
      showChainStatus(label + ' submitted. Waiting for a qBESU block, which may take about a minute.', 'pending', txHash);
      const receipt = await ArtIDChain.waitForReceipt(txHash);
      if (receipt.status !== 'confirmed') throw new Error(label + ' failed on qBESU.');
      confirmed = true;
      await refreshChainState();
      showChainStatus(label + ' confirmed on qBESU.', 'success', txHash);
      return { txHash: txHash, blockNumber: receipt.blockNumber };
    } catch (error) {
      if (confirmed) error = new Error(label + ' confirmed, but the registry refresh failed: ' + error.message);
      showChainStatus(error.message, 'error', txHash);
      throw error;
    } finally {
      state.busy = null;
      renderPage();
    }
  }

  async function inspectMandate(id, artwork) {
    if (!state.user || !state.account) throw new Error('Unlock the principal wallet first.');
    if (!artwork) throw new Error('Enter an artwork contract address.');
    return ArtIDChain.getMandate(id, artwork);
  }

  async function mandateTransferDetails(id, artwork) {
    const profile = state.user;
    const account = state.account;
    const record = await inspectMandate(id, artwork);
    if (!account || profile !== state.user || account !== state.account) throw new Error('Wallet changed; inspect the mandate again.');
    if (!sameAddress(record.principal, account.address)) throw new Error('This mandate belongs to a different wallet.');
    if (record.revoked || record.expiresAt * 1000 <= Date.now() || record.remainingTransfers === '0') throw new Error('This mandate is revoked, expired, or exhausted.');
    if (!record.permitted || !sameAddress(record.owner, record.principal)) throw new Error('Artwork is not permitted or no longer owned by the principal.');
    if (!record.approved) throw new Error('The principal must approve this artwork for the mandate contract first.');
    if (!state.artworks.some(item => sameAddress(item.address, artwork))) throw new Error('Artwork is not in the loaded registry.');
    return record;
  }

  function mandateConfirmation(record) {
    return {
      title: 'Execute mandated artwork transfer?',
      detail: 'The principal wallet will sign. Payment and price are not enforced. Direct transfers remain possible outside this mandate.',
      facts: {
        'Mandate ID': record.id,
        Principal: record.principal,
        Artwork: record.artwork,
        Recipient: record.recipient,
        Expiry: new Date(record.expiresAt * 1000).toLocaleString(),
        'Transfers remaining': record.remainingTransfers,
      },
    };
  }

  async function executeMandatedTransfer(id, artwork, approvedRecord, profile) {
    if (profile !== state.user) throw new Error('Wallet changed; inspect the mandate again.');
    const current = await mandateTransferDetails(id, artwork);
    if (profile !== state.user) throw new Error('Wallet changed; inspect the mandate again.');
    if (current.id !== approvedRecord.id || !sameAddress(current.principal, approvedRecord.principal) ||
      !sameAddress(current.recipient, approvedRecord.recipient) || !sameAddress(current.artwork, approvedRecord.artwork) ||
      current.expiresAt !== approvedRecord.expiresAt || current.remainingTransfers !== approvedRecord.remainingTransfers) {
      throw new Error('Mandate details changed after confirmation; inspect and confirm again.');
    }
    return chainWrite('Mandated artwork transfer', () => ArtIDChain.executeMandate(profile, id, artwork));
  }

  async function handleMandate(action) {
    const status = $('agentMandateStatus');
    const id = $('agentMandateId').value.trim();
    const artwork = $('agentMandateArtwork').value.trim();
    try {
      if (action === 'read') {
        const record = await inspectMandate(id, artwork);
        status.textContent = 'Mandate #' + record.id + ': principal ' + record.principal + '; recipient ' + record.recipient +
          '; expires ' + new Date(record.expiresAt * 1000).toLocaleString() + '; remaining ' + record.remainingTransfers +
          '; revoked ' + (record.revoked ? 'yes' : 'no') + '; artwork permitted ' + (record.permitted ? 'yes' : 'no') +
          '; owner ' + record.owner + '; approved ' + (record.approved ? 'yes' : 'no') + '.';
        return;
      }
      if (pendingApproval || state.busy) throw new Error('Another approval or transaction is in progress.');
      const profile = state.user;
      const record = await mandateTransferDetails(id, artwork);
      if (pendingApproval || state.busy) throw new Error('Another approval or transaction is in progress.');
      if (!await askPerson(mandateConfirmation(record))) throw new Error('Transfer declined; nothing was signed.');
      if (profile !== state.user) throw new Error('Wallet changed; inspect the mandate again.');
      const result = await executeMandatedTransfer(id, artwork, record, profile);
      status.textContent = 'Mandated transfer confirmed: ' + result.txHash;
    } catch (error) {
      status.textContent = error.message;
      showChainStatus(error.message, 'error');
    }
  }

  function requireActiveProfile() {
    const a = state.account;
    if (!a) throw new Error('Log in first.');
    if (!a.registered) throw new Error('Register this collector profile first.');
    if (!a.listed) throw new Error('This profile is unlisted. List it again before trading.');
    return a;
  }

  /* ---------------- wallet page ---------------- */

  function ownedArtworks() {
    const address = state.account && state.account.address;
    return state.artworks.filter(p => address && sameAddress(p.owner, address));
  }

  function renderWallet() {
    const profile = state.user;
    const who = PEOPLE[profile];
    const account = state.account;
    const artist = state.role === 'artist';
    $('walletPage').className = 'rs-view rs-account wm-page rs-region-' + who.region.key;
    $('walletRegion').textContent = who.region.name;
    $('walletAvatar').textContent = who.initial;
    $('walletRole').textContent = ROLES[state.role].wallet;
    $('walletName').textContent = who.name;
    $('walletEoa').textContent = account ? shorten(account.address) : '—';
    $('walletEoa').title = account ? account.address : '';
    const count = ownedArtworks().length;
    $('walletWorkCount').textContent = !account ? '—' : count === 1 ? '1 artwork' : count + ' artworks';
    $('collectionHint').textContent = artist ? 'Works in this wallet. Select one to sell.' : 'Works in this wallet.';
    $('sideHeading').textContent = artist ? 'Sell' : 'Buy';
    $('sideHint').textContent = artist ? 'Set a price, then share the payment code.' : 'Load the seller’s payment code.';
    $('createSection').hidden = !artist;
    $('createArtworkBtn').disabled = Boolean(state.busy);
    $('createArtworkBtn').textContent = state.busy === 'Artwork registration' ? 'Registering…' : 'Register artwork';
    renderCollection();
    if (artist) renderSeller(); else renderBuyer();
    renderProfile();
  }

  function renderProfile() {
    const account = state.account;
    if (!account) return;
    const busy = Boolean(state.busy);
    const status = $('walletListingStatus');
    status.textContent = account.registered ? account.listed ? 'Listed' : 'Unlisted' : 'Not registered';
    status.classList.toggle('is-unlisted-label', account.registered && !account.listed);
    status.classList.toggle('is-unregistered', !account.registered);
    $('walletDid').innerHTML = !account.registered ? 'Not registered'
      : account.registrationTxHash ? transactionLink(account.registrationTxHash, account.did)
      : escapeHtml(account.did);
    const name = $('displayNameInput');
    const uri = $('metadataInput');
    if (document.activeElement !== name) name.value = account.displayName || PEOPLE[state.user].name;
    if (document.activeElement !== uri) uri.value = account.metadataURI || '';
    name.disabled = uri.disabled = account.registered && !account.listed;
    $('metadataEntry').hidden = !account.registered;
    $('saveProfileBtn').disabled = busy || !account.listed;
    $('registerProfileBtn').hidden = account.registered;
    $('registerProfileBtn').disabled = busy;
    $('registerProfileBtn').textContent = state.busy === 'Collector registration' ? 'Registering…' : 'Register collector';
    const toggle = $('profileListingToggle');
    toggle.hidden = !account.registered;
    toggle.disabled = busy;
    toggle.textContent = account.listed ? 'Unlist collector' : 'List collector';
    // registration needs the display name field, so keep it in reach until done
    if (!account.registered) $('profileManage').open = true;
    const enabled = account.registered && account.listed;
    $('unlistedNotice').hidden = !account.registered || account.listed;
    $('walletActions').classList.toggle('is-inactive', !enabled);
    $('walletActions').inert = !enabled;
    renderMetadataHistory(account.metadataHistory || []);
  }

  function renderMetadataHistory(history) {
    const container = $('metadataHistory');
    container.replaceChildren();
    container.hidden = !history.length;
    if (!history.length) return;
    const heading = document.createElement('summary');
    heading.textContent = 'Profile history (' + history.length + ')';
    container.appendChild(heading);
    history.forEach(item => {
      const row = document.createElement('div');
      row.className = 'rs-metadata-history-item';
      const detail = document.createElement('span');
      detail.textContent = [item.displayName, item.metadataURI].filter(Boolean).join(' · ') || 'Metadata saved';
      row.appendChild(detail);
      const link = document.createElement('a');
      link.href = 'https://quantumbesu.web.app/quantumbesu.html?transaction=' + encodeURIComponent(item.transactionHash);
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = item.transactionHash;
      row.appendChild(link);
      container.appendChild(row);
    });
  }

  function folderTile(p, onPick) {
    const tile = document.createElement('article');
    const active = state.selected && state.selected.id === p.id;
    tile.className = 'rs-piece' + (active ? ' is-active' : '') + (p.listed ? '' : ' is-unlisted');
    const pickable = Boolean(onPick);
    tile.innerHTML = `
      <${pickable ? 'button type="button"' : 'div'} class="rs-piece-select"${pickable ? ` aria-pressed="${active}"` : ''}>
        <span class="rs-thumb">
          ${artImage(p, '')}
          ${p.listed ? '' : '<span class="rs-pill is-muted rs-media-pill">Unlisted</span>'}
          ${pickable ? `<span class="rs-piece-check" aria-hidden="true">${CHECK}</span>` : ''}
        </span>
        <span class="rs-piece-body">
          <span class="rs-piece-artist">${escapeHtml(p.artist || 'Unknown artist')}</span>
          <span class="rs-piece-title">${escapeHtml(p.title)}</span>
        </span>
      </${pickable ? 'button' : 'div'}>
      <div class="rs-piece-proof" title="${escapeHtml(p.did)}">${ICON_VERIFIED}${/^0x[a-fA-F0-9]{64}$/.test(p.creationTxHash || '') ? transactionLink(p.creationTxHash, 'Verified record') : '<span>Verified record</span>'}</div>`;
    const select = tile.querySelector('.rs-piece-select');
    if (pickable && p.listed) select.addEventListener('click', () => selectPiece(p));
    else if (pickable) select.disabled = true;
    return tile;
  }

  function renderCollection() {
    const owned = ownedArtworks();
    const el = $('collection');
    if (!owned.length) {
      el.innerHTML = emptyState(state.role === 'artist'
        ? 'No artworks in this wallet yet. Register one below to start your collection.'
        : 'No artworks yet. Works you buy appear here once the transfer is confirmed.');
      return;
    }
    el.innerHTML = '';
    owned.forEach(p => el.appendChild(folderTile(p, state.role === 'artist' ? selectPiece : null)));
  }

  /* ---------------- seller ---------------- */

  function myListing() {
    return state.account ? state.listings.get(state.account.address.toLowerCase()) || null : null;
  }

  function selectPiece(p) {
    const owned = ownedArtworks().find(item => item.id === p.id);
    if (!owned) throw new Error('That artwork is not in this wallet.');
    if (!owned.listed) throw new Error('That artwork is unlisted. List it in the registry before selling.');
    state.selected = owned;
    if (state.account) state.listings.delete(state.account.address.toLowerCase());
    renderWallet();
  }

  function createListing(amount) {
    const account = requireActiveProfile();
    if (!state.selected) throw new Error('Select an artwork to sell first.');
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) throw new Error('Enter a price above zero.');
    state.price = value;
    // The code carries the address only. A version-6 / ECC-H symbol holds
    // about 58 bytes and the full record is 88, so the piece and the price
    // are resolved from the address instead.
    state.listings.set(account.address.toLowerCase(), {
      seller: state.user, address: account.address, amount: String(value), art: state.selected.id
    });
    renderSeller();
    return myListing();
  }

  function cancelListing() {
    if (state.account) state.listings.delete(state.account.address.toLowerCase());
    renderSeller();
  }

  function renderSeller() {
    const el = $('sidePanel');
    const listing = myListing();
    if (listing && (!state.selected || state.selected.id !== listing.art)) state.selected = piece(listing.art) || null;
    if (!state.selected) {
      el.innerHTML = `
        <div class="rs-scan-target">
          ${ICON_ART}
          <div class="rs-hint">Select a work from your collection to sell it.</div>
        </div>`;
      return;
    }
    const p = state.selected;
    if (!listing) {
      el.innerHTML = `
        <div class="rs-listing">
          ${artImage(p, 'rs-listing-thumb')}
          <div class="rs-listing-meta">
            <span class="rs-piece-artist">${escapeHtml(p.artist || 'Unknown artist')}</span>
            <strong>${escapeHtml(p.title)}</strong>
            <span class="rs-mono-sm" title="${escapeHtml(p.erc721)}">ID token ${shorten(p.erc721)}</span>
          </div>
        </div>
        <div class="rs-field">
          <label for="priceInput">Asking price</label>
          <div class="rs-money-input">
            <span aria-hidden="true">HK$</span>
            <input type="number" class="rs-input" id="priceInput" min="1" step="1" inputmode="decimal" value="${state.price}">
          </div>
        </div>
        <p class="rs-hint">The buyer pays this amount. In this demo the payment is simulated; the ownership transfer is real.</p>
        <button class="rs-btn rs-btn-primary rs-btn-block" id="listBtn" type="button">Create payment code</button>`;
      $('listBtn').addEventListener('click', () => {
        const input = $('priceInput');
        try {
          input.setCustomValidity('');
          createListing(input.value);
        } catch (error) {
          input.setCustomValidity(error.message);
          input.reportValidity();
          input.focus();
        }
      });
      return;
    }

    el.innerHTML = `
      <div class="rs-ready"><span class="rs-pill is-success">${CHECK}Ready to share</span></div>
      <dl class="rs-kv">
        <div><dt>Artwork</dt><dd>${escapeHtml(p.title)}</dd></div>
        <div><dt>Asking price</dt><dd class="rs-amount">HK$ ${fmt(Number(listing.amount))}</dd></div>
        <div><dt>ID token</dt><dd class="rs-mono-sm" title="${escapeHtml(p.erc721)}">${shorten(p.erc721)}</dd></div>
      </dl>
      <figure class="rs-code-stage">
        <canvas id="rsQrCanvas" role="img" aria-label="Payment code over ${escapeHtml(p.title)}"></canvas>
        <figcaption>
          ${artImage(p, 'rs-code-thumb')}
          <span><b>Payment code</b> over ${escapeHtml(p.title)}</span>
        </figcaption>
      </figure>
      <div class="rs-slider-row">
        <label for="lightInput">Lighten artwork behind code</label>
        <output id="lightValue" for="lightInput">${state.lightening}%</output>
        <input type="range" id="lightInput" min="0" max="100" step="1" value="${state.lightening}">
        <span class="rs-slider-scale" aria-hidden="true"><span>Richer artwork</span><span>Easier to scan</span></span>
      </div>
      <div class="rs-scanstate" id="scanState" aria-live="polite"></div>
      <div class="rs-stack">
        <button class="rs-btn rs-btn-primary rs-btn-block" id="saveQrBtn" type="button">Save payment code</button>
        <button class="rs-btn rs-btn-quiet rs-btn-block" id="editListingBtn" type="button">Change price</button>
      </div>
      <details class="rs-disclosure">
        <summary>How the buyer uses this code</summary>
        <p class="rs-hint">Save the PNG, then log in as the buyer, choose <b>Collector</b> and load it. If the check above says the code will not scan, lighten the artwork behind it first.</p>
        <div class="rs-payload">${escapeHtml(qrPayload(listing))}</div>
      </details>`;

    drawSellerQr();
    $('lightInput').addEventListener('input', event => {
      setLightening(Number(event.target.value));
    });
    $('saveQrBtn').addEventListener('click', savePaymentCode);
    $('editListingBtn').addEventListener('click', cancelListing);
  }

  const qrPayload = listing => 'ethereum:' + listing.address;

  function setLightening(value) {
    state.lightening = Math.max(0, Math.min(100, Math.round(value)));
    if ($('lightInput')) $('lightInput').value = state.lightening;
    if ($('lightValue')) $('lightValue').value = state.lightening + '%';
    return drawSellerQr();
  }

  /* Background images for the payment code, keyed by URL and loaded with CORS
     so the canvas stays readable for the scan check and the PNG export. */
  const qrBackgrounds = new Map();

  function qrBackground(p) {
    const src = displayImageUrl(p.imageURI);
    if (!src) return Promise.resolve(null);
    if (!qrBackgrounds.has(src)) qrBackgrounds.set(src, AddrQR.loadImage(src));
    return qrBackgrounds.get(src);
  }

  /** Draws the code and resolves to whether it decodes, or null if not drawn. */
  async function drawSellerQr() {
    const canvas = $('rsQrCanvas');
    const selected = state.selected;
    const listing = myListing();
    if (!canvas || !selected || !listing) return null;
    const background = await qrBackground(selected);
    // the panel may have re-rendered while the image loaded
    if (canvas !== $('rsQrCanvas') || selected !== state.selected) return null;
    try {
      AddrQR.render(canvas, { address: listing.address, background: background, lightening: state.lightening });
      return reportScannability(canvas, qrPayload(listing), Boolean(background));
    } catch (error) {
      console.error('Overlay QR failed, falling back to a plain code:', error);
      await QRCode.toCanvas(canvas, qrPayload(listing), { width: 180, margin: 2 });
      return reportScannability(canvas, qrPayload(listing), false);
    }
  }

  /* Decode the code just drawn and say whether it reads - the check a seller
     would otherwise only discover when the buyer's upload failed. */
  function reportScannability(canvas, payload, hasArtwork) {
    let ok = false;
    try {
      const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
      const res = jsQR(d.data, canvas.width, canvas.height);
      ok = Boolean(res) && res.data === payload;
    } catch (error) { ok = false; }
    const el = $('scanState');
    if (el) {
      el.className = 'rs-scanstate ' + (ok ? 'ok' : 'bad');
      el.innerHTML = !ok
        ? '<span class="rs-x">✕</span><span>Too dark to scan. Move the slider right.</span>'
        : hasArtwork
          ? CHECK + '<span>Code is scannable</span>'
          : CHECK + '<span>Scannable · artwork image unavailable, shown on white</span>';
    }
    return ok;
  }

  async function savePaymentCode() {
    await drawSellerQr();
    const canvas = $('rsQrCanvas');
    if (!canvas) throw new Error('Create a payment code first.');
    const a = document.createElement('a');
    a.download = 'artid-' + state.selected.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '-payment-code.png';
    a.href = canvas.toDataURL('image/png');
    document.body.appendChild(a);
    a.click();
    a.remove();
    return a.download;
  }

  /* ---------------- buyer ---------------- */

  function resetPurchase() {
    state.scanned = null;
    state.stage = 'idle';
    state.channel = 'chain';
    state.payRef = null;
    state.txHash = null;
  }

  /** Resolve a decoded payment code (an address or ethereum: URI) to its listing. */
  function acceptPaymentCode(text) {
    const account = requireActiveProfile();
    const address = AddrQR.normalizeAddress(String(text || '').trim());
    if (!address) throw new Error('That code is not a wallet address.');
    if (sameAddress(address, account.address)) throw new Error('That is your own payment code.');
    const listing = state.listings.get(address.toLowerCase());
    if (!listing) throw new Error('No active listing for ' + shorten(address) + '.');
    if (!piece(listing.art)) throw new Error('That artwork is not present in the on-chain registry.');
    state.scanned = Object.assign({}, listing);
    state.stage = 'scanned';
    state.txHash = null;
    renderBuyer();
    return state.scanned;
  }

  function loadPaymentCodeFile(file) {
    const say = message => {
      const el = $('loadState');
      if (!el) return;
      el.hidden = false;
      el.className = 'rs-scanstate bad';
      el.innerHTML = '<span class="rs-x">✕</span><span>' + escapeHtml(message) + '</span>';
    };
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = function () {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(objectUrl);
      let res = null;
      try {
        res = jsQR(ctx.getImageData(0, 0, c.width, c.height).data, c.width, c.height);
      } catch (error) { /* reported below */ }
      if (!res) {
        say('No code found in that image. If the seller’s check was red, it cannot be read.');
        return;
      }
      try { acceptPaymentCode(res.data); } catch (error) { say(error.message); }
    };
    img.onerror = function () {
      URL.revokeObjectURL(objectUrl);
      say('That file could not be opened as an image.');
    };
    img.src = objectUrl;
  }

  function pay(method) {
    if (!state.scanned || state.stage !== 'scanned') throw new Error('Load a payment code first.');
    if (method) {
      if (!['chain', 'card'].includes(method)) throw new Error('Pay with "chain" or "card".');
      state.channel = method;
    }
    state.stage = 'paid';
    state.payRef = state.channel === 'card' ? 'auth ' + rndAuth() : rndHex(64).slice(0, 18) + '…';
    renderBuyer();
    return { method: state.channel, reference: state.payRef, simulated: true };
  }

  /* The seller signs the ownership transfer with their own ICCHSM wallet. Only
     one person is logged in here, so in this demo the seller approves on this
     device with their PIN, which is cleared again straight after signing. */
  async function completeTransfer(sellerPin) {
    if (!state.scanned || !['paid', 'transferFailed'].includes(state.stage)) {
      throw new Error('Pay for the artwork before transferring ownership.');
    }
    const account = requireActiveProfile();
    const p = piece(state.scanned.art);
    if (!p) throw new Error('The artwork is not found in the on-chain registry.');
    if (state.busy) throw new Error('Another transaction is still confirming: ' + state.busy + '.');
    const seller = state.scanned.seller;
    const borrowed = !isConnected(seller);
    state.busy = 'Ownership transfer';
    state.stage = 'transferring';
    renderBuyer();
    try {
      if (borrowed) {
        if (!String(sellerPin || '').trim()) throw new Error(PEOPLE[seller].name + '’s wallet PIN is needed to release the artwork.');
        await ArtIDChain.connect(seller, sellerPin);
      }
      const result = await ArtIDChain.transfer(p.erc721, seller, state.user);
      state.txHash = result.txHash;
      showChainStatus('ID token transfer submitted. Waiting for a qBESU block, which may take about a minute.', 'pending', state.txHash);
      const receipt = await ArtIDChain.waitForReceipt(state.txHash);
      if (receipt.status !== 'confirmed') throw new Error('qBESU returned a failed transaction receipt.');
      await refreshChainState();
      // trust the owner read back from the chain, not just the receipt
      const current = piece(state.scanned.art);
      if (!current || !sameAddress(current.owner, account.address)) {
        throw new Error('The receipt succeeded but the ownership read did not show ' + PEOPLE[state.user].name + ' as owner.');
      }
      state.stage = 'transferred';
      showChainStatus('ID token transfer confirmed on qBESU.', 'success', state.txHash);
      return { txHash: state.txHash, blockNumber: receipt.blockNumber, owner: PEOPLE[state.user].name };
    } catch (error) {
      state.stage = 'transferFailed';
      showChainStatus(error.message, 'error', state.txHash);
      throw error;
    } finally {
      if (borrowed) ArtIDChain.lock(seller);
      state.busy = null;
      if (state.page === 'wallet') renderWallet();
    }
  }

  function renderBuyer() {
    const el = $('sidePanel');
    const me = PEOPLE[state.user].name;

    if (state.stage === 'transferred' && state.scanned) {
      const done = piece(state.scanned.art);
      el.innerHTML = `
        <div class="rs-done">
          <span class="rs-done-mark">${CHECK}</span>
          <strong>It's yours</strong>
          <span>Added to your collection.</span>
        </div>
        ${done ? `<div class="rs-listing">
          ${artImage(done, 'rs-listing-thumb')}
          <div class="rs-listing-meta">
            <span class="rs-piece-artist">${escapeHtml(done.artist || 'Unknown artist')}</span>
            <strong>${escapeHtml(done.title)}</strong>
            <span>Bought from ${escapeHtml(ownerLabel(state.scanned.address))}</span>
          </div>
        </div>` : ''}
        <dl class="rs-kv">
          <div><dt>Price paid</dt><dd class="rs-amount">HK$ ${fmt(Number(state.scanned.amount))}</dd></div>
          <div><dt>Ownership transfer</dt><dd>${transactionLink(state.txHash, 'Confirmed · ' + shorten(state.txHash))}</dd></div>
        </dl>
        <div class="rs-steps">
          ${step(1, 'Payment simulated', 'No payment was taken', true)}
          ${step(2, 'Transfer confirmed', 'Ownership updated on qBESU', true)}
          ${step(3, 'Added to collection', 'Now in ' + escapeHtml(me) + '’s wallet', true)}
        </div>
        <button class="rs-btn rs-btn-primary rs-btn-block" id="nextBtn" type="button">Done</button>`;
      $('nextBtn').addEventListener('click', () => { resetPurchase(); renderBuyer(); });
      return;
    }

    if (!state.scanned) {
      el.innerHTML = `
        <label class="rs-drop" for="qrFile" id="qrDrop">
          <span class="rs-drop-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16"/><path d="M8 12h8"/>
            </svg>
          </span>
          <strong>Load payment code</strong>
          <span>Choose or drop the seller’s image</span>
          <input type="file" id="qrFile" accept="image/png,image/jpeg" hidden>
        </label>
        <div class="rs-scanstate" id="loadState" hidden></div>
        <p class="rs-hint">Decoded in your browser. Nothing is uploaded.</p>`;
      $('qrFile').addEventListener('change', event => {
        const file = event.target.files && event.target.files[0];
        if (file) loadPaymentCodeFile(file);
      });
      const drop = $('qrDrop');
      drop.addEventListener('dragover', event => { event.preventDefault(); drop.classList.add('is-over'); });
      drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
      drop.addEventListener('drop', event => {
        event.preventDefault();
        drop.classList.remove('is-over');
        const file = event.dataTransfer.files && event.dataTransfer.files[0];
        if (file) loadPaymentCodeFile(file);
      });
      return;
    }

    const p = piece(state.scanned.art);
    if (!p) {
      el.innerHTML = '<div class="rs-scanstate bad"><span>That artwork is not present in the on-chain registry.</span></div>';
      return;
    }
    const seller = state.scanned.seller;
    const isCard = state.channel === 'card';
    const paid = state.stage === 'paid';
    const failed = state.stage === 'transferFailed';
    const transferring = state.stage === 'transferring';
    const locked = paid || failed || transferring;
    const needsSellerPin = (paid || failed) && !isConnected(seller);

    el.innerHTML = `
      <div class="rs-listing">
        ${artImage(p, 'rs-listing-thumb')}
        <div class="rs-listing-meta">
          <span class="rs-piece-artist">${escapeHtml(p.artist || 'Unknown artist')}</span>
          <strong>${escapeHtml(p.title)}</strong>
          <span title="${escapeHtml(state.scanned.address)}">Sold by ${escapeHtml(ownerLabel(state.scanned.address))}</span>
        </div>
      </div>
      <dl class="rs-kv">
        <div><dt>Artwork price</dt><dd>HK$ ${fmt(Number(state.scanned.amount))}</dd></div>
        <div><dt>ID token</dt><dd class="rs-mono-sm" title="${escapeHtml(p.erc721)}">${shorten(p.erc721)}</dd></div>
        <div class="is-total"><dt>Total</dt><dd class="rs-amount">HK$ ${fmt(Number(state.scanned.amount))}</dd></div>
      </dl>
      <p class="rs-notice">Demo payment only. The ownership transfer is recorded on qBESU.</p>
      ${transferring ? '<div class="rs-inline-status"><span class="rs-chain-spinner"></span><span>Confirming on qBESU. This may take a minute.</span></div>' : ''}
      ${failed ? '<div class="rs-scanstate bad"><span class="rs-x">✕</span><span>Transfer failed. Ownership has not changed.</span></div>' : ''}
      <fieldset class="rs-fieldset">
        <legend>Pay with</legend>
        <div class="rs-channels">
          <button type="button" class="rs-channel ${isCard ? '' : 'is-active'}" data-ch="chain" aria-pressed="${!isCard}" ${locked ? 'disabled' : ''}>
            <span class="rs-channel-name">On-chain</span><span class="rs-channel-sub">Simulated</span>
          </button>
          <button type="button" class="rs-channel ${isCard ? 'is-active' : ''}" data-ch="card" aria-pressed="${isCard}" ${locked ? 'disabled' : ''}>
            <span class="rs-channel-name">Visa</span><span class="rs-channel-sub">Visa · simulated</span>
          </button>
        </div>
      </fieldset>
      <div class="rs-steps">
        ${step(1, 'Payment', paid || failed || transferring ? 'Simulated · ' + escapeHtml(state.payRef || '') : 'Simulated', locked, !locked)}
        ${step(2, 'Seller releases the artwork', escapeHtml(PEOPLE[seller].name) + ' signs the transfer on qBESU', false, locked)}
        ${step(3, 'Add to collection', 'After confirmation', false)}
      </div>
      ${needsSellerPin ? `<div class="rs-field">
        <label for="sellerPinInput">${escapeHtml(PEOPLE[seller].name)}’s wallet PIN</label>
        <input class="rs-input" id="sellerPinInput" type="password" inputmode="numeric" autocomplete="off">
        <p class="rs-hint">The seller signs the release with their ICCHSM wallet. In this demo they approve on this device; the PIN is cleared straight after.</p>
      </div>` : ''}
      <div class="rs-cta-bar">
        <button class="rs-btn rs-btn-primary rs-btn-block rs-btn-lg" id="payBtn" type="button" ${transferring ? 'disabled' : ''}>
          ${transferring ? 'Confirming transfer…' : failed ? 'Retry ownership transfer' : paid ? 'Release and transfer ownership' : 'Pay HK$ ' + fmt(Number(state.scanned.amount))}
        </button>
      </div>
      ${transferring ? '' : '<button class="rs-btn rs-btn-quiet rs-btn-block" id="cancelPurchaseBtn" type="button">Cancel</button>'}`;

    el.querySelectorAll('.rs-channel').forEach(button =>
      button.addEventListener('click', () => { state.channel = button.dataset.ch; renderBuyer(); }));
    if (paid || failed) {
      $('payBtn').addEventListener('click', () => {
        const input = $('sellerPinInput');
        completeTransfer(input ? input.value : '').catch(() => {});
      });
    } else if (!transferring) {
      $('payBtn').addEventListener('click', () => pay());
    }
    if ($('cancelPurchaseBtn')) $('cancelPurchaseBtn').addEventListener('click', () => { resetPurchase(); renderBuyer(); });
  }

  /* ---------------- profile and artwork writes ---------------- */

  function registerProfile(displayName, metadataURI) {
    const account = state.account;
    if (!account) throw new Error('Log in first.');
    if (account.registered) throw new Error('This profile is already registered.');
    const name = String(displayName || '').trim();
    if (!name) throw new Error('Collector display name is required.');
    return chainWrite('Collector registration', () =>
      ArtIDChain.registerCollector(state.user, name, String(metadataURI || '').trim()));
  }

  function updateProfile(displayName, metadataURI) {
    requireActiveProfile();
    const name = String(displayName || '').trim();
    if (!name) throw new Error('Collector display name is required.');
    return chainWrite('Profile update', () =>
      ArtIDChain.updateCollector(state.user, name, String(metadataURI || '').trim()));
  }

  function setProfileListed(listed) {
    const account = state.account;
    if (!account || !account.registered) throw new Error('Register this collector profile first.');
    return chainWrite(listed ? 'Collector listing' : 'Collector unlisting', () =>
      ArtIDChain.setCollectorListed(state.user, Boolean(listed)));
  }

  function setArtworkListed(artwork, listed) {
    requireActiveProfile();
    if (!sameAddress(artwork.owner, state.account.address)) throw new Error('Only the owner can list or unlist "' + artwork.title + '".');
    return chainWrite(listed ? 'Artwork listing' : 'Artwork unlisting', () =>
      ArtIDChain.setArtworkListed(artwork.erc721, state.user, Boolean(listed)));
  }

  function artworkIdFor(title) {
    return 'did:art:artwork:' + ethers.keccak256(ethers.toUtf8Bytes(title));
  }

  /* Artwork IDs are unique on chain, so an edited work is registered under a
     new ID and the old record unlisted - checked here before signing. */
  function registerArtwork(input) {
    requireActiveProfile();
    if (state.role !== 'artist') throw new Error('Switch to the artist role to register artworks.');
    const metadata = {
      title: String(input.title || '').trim(),
      artist: String(input.artist || '').trim(),
      artworkId: String(input.artworkId || '').trim(),
      imageURI: String(input.imageURI || '').trim(),
      contentHash: String(input.contentHash || '').trim()
    };
    if (!metadata.title) throw new Error('An artwork title is required.');
    if (!metadata.artworkId) metadata.artworkId = artworkIdFor(metadata.title);
    if (state.artworks.some(p => p.artworkId === metadata.artworkId)) {
      throw new Error('Artwork ID ' + metadata.artworkId + ' is already registered. Use a new ID or title.');
    }
    return chainWrite('Artwork registration', () => ArtIDChain.createArtwork(state.user, metadata))
      .then(result => Object.assign(result, { artworkId: metadata.artworkId }));
  }

  function registerArtworkFromForm() {
    const fields = { title: 'artworkTitleInput', artist: 'artworkArtistInput', artworkId: 'artworkIdInput', imageURI: 'artworkImageInput', contentHash: 'artworkHashInput' };
    const input = {};
    Object.keys(fields).forEach(key => { input[key] = $(fields[key]).value; });
    const title = $('artworkTitleInput');
    if (!input.title.trim()) {
      title.setCustomValidity('This field is required.');
      title.reportValidity();
      title.focus();
      return;
    }
    title.setCustomValidity('');
    try {
      registerArtwork(input).then(() => {
        Object.values(fields).forEach(id => { $(id).value = ''; });
      }).catch(() => {});
    } catch (error) {
      showChainStatus(error.message, 'error');
    }
  }

  /* ---------------- registry page ---------------- */

  const HIDE_UNLISTED_KEY = 'artid.hideUnlisted';

  function readHideUnlisted() {
    try { return localStorage.getItem(HIDE_UNLISTED_KEY) !== 'false'; } catch (error) { return true; }
  }

  function setHideUnlisted(hide) {
    state.hideUnlisted = Boolean(hide);
    try { localStorage.setItem(HIDE_UNLISTED_KEY, String(state.hideUnlisted)); } catch (error) { /* won't persist */ }
    if (state.page === 'registry') renderRegistry();
  }

  function renderRegistry() {
    const unlisted = state.artworks.filter(p => !p.listed).length;
    const shown = state.hideUnlisted ? state.artworks.filter(p => p.listed) : state.artworks;
    const toggle = $('hideUnlistedToggle');
    toggle.hidden = !unlisted;
    toggle.setAttribute('aria-checked', String(state.hideUnlisted));
    $('unlistedCount').textContent = unlisted ? '(' + unlisted + ')' : '';
    $('artworkCount').textContent = shown.length || '';
    $('collectorCount').textContent = state.collectors.length || '';
    $('backToWalletBtn').hidden = !state.role;
    const mine = state.account && state.account.registered && state.account.listed ? state.account.address : null;

    if (!state.artworks.length) {
      $('registryBody').innerHTML = emptyState(state.synced ? 'No artworks are registered yet.' : 'Loading the registry from qBESU…');
    } else if (!shown.length) {
      $('registryBody').innerHTML = emptyState((unlisted === 1 ? 'The only artwork is unlisted.' : 'All ' + unlisted + ' artworks are unlisted.') +
        ' Turn off <b>Hide unlisted</b> to see ' + (unlisted === 1 ? 'it.' : 'them.'));
    } else {
      $('registryBody').innerHTML = shown.map(p => {
        const canToggle = sameAddress(p.owner, mine) && !state.busy;
        return `
          <article class="rs-art-card ${p.listed ? '' : 'is-unlisted'}">
            <div class="rs-art-card-media">
              ${artImage(p, '')}
              ${p.listed ? '' : '<span class="rs-pill is-muted rs-media-pill">Unlisted</span>'}
            </div>
            <div class="rs-art-card-body">
              <span class="rs-piece-artist">${escapeHtml(p.artist || 'Unknown artist')}</span>
              <h3 class="rs-art-title">${escapeHtml(p.title)}</h3>
              <div class="rs-art-owner">${partyChip(p.owner)}</div>
              <div class="rs-art-actions">
                <span class="rs-pill ${p.listed ? 'is-success' : 'is-muted'}">${p.listed ? 'Listed' : 'Unlisted'}</span>
                <button class="rs-btn rs-btn-sm" type="button" data-artwork-listing="${escapeHtml(p.erc721)}" ${canToggle ? '' : 'disabled'}
                  title="${canToggle ? '' : 'Only the logged-in owner can change this'}">${p.listed ? 'Unlist' : 'List'}</button>
              </div>
              <details class="rs-disclosure">
                <summary>Provenance &amp; verification</summary>
                <dl class="rs-kv rs-kv-compact">
                  <div><dt>Artwork ID</dt><dd>${escapeHtml(p.artworkId)}</dd></div>
                  <div><dt>Artwork DID</dt><dd>${p.creationTxHash ? transactionLink(p.creationTxHash, p.did) : escapeHtml(p.did)}</dd></div>
                  <div><dt>ID token</dt><dd>${escapeHtml(p.erc721)} · #1</dd></div>
                  <div><dt>Registered by</dt><dd title="${escapeHtml(p.creator)}">${escapeHtml(ownerLabel(p.creator))}</dd></div>
                  <div><dt>Content hash</dt><dd title="${escapeHtml(p.contentHash)}">${p.contentHash ? escapeHtml(shorten(p.contentHash)) : '—'}</dd></div>
                  <div><dt>Latest transfer</dt><dd>${transactionLink(p.transferTxHash)}</dd></div>
                  <div><dt>Listing record</dt><dd>${transactionLink(p.listingTxHash || p.creationTxHash)}</dd></div>
                </dl>
              </details>
            </div>
          </article>`;
      }).join('');
    }

    const collectorBody = $('collectorRegistryBody');
    if (!state.collectors.length) {
      collectorBody.innerHTML = emptyState(state.synced ? 'No collectors are registered yet.' : 'Loading collectors…');
    } else {
      collectorBody.innerHTML = state.collectors.map(collector => {
        const region = regionForAddress(collector.address);
        const own = state.account && sameAddress(collector.address, state.account.address) && !state.busy;
        const latest = collector.metadataHistory[collector.metadataHistory.length - 1];
        return `
          <article class="rs-person ${collector.listed ? '' : 'is-unlisted'} ${region ? 'rs-region-' + region.key : ''}">
            <span class="rs-person-avatar">${escapeHtml((collector.displayName || '?').replace(/^(Artist|Collector)\s+/i, '').charAt(0).toUpperCase())}</span>
            <div class="rs-person-body">
              <strong>${escapeHtml(collector.displayName)}</strong>
              <span class="rs-person-meta">${region ? `<span class="rs-region-chip"><span aria-hidden="true"></span>${region.name}</span>` : ''}<span class="rs-mono-sm" title="${escapeHtml(collector.address)}">${shorten(collector.address)}</span></span>
            </div>
            <div class="rs-person-side">
              <span class="rs-pill ${collector.listed ? 'is-success' : 'is-muted'}">${collector.listed ? 'Listed' : 'Unlisted'}</span>
              <button class="rs-btn rs-btn-sm" type="button" data-collector-listing="${escapeHtml(collector.address)}" ${own ? '' : 'disabled'}
                title="${own ? '' : 'Only the logged-in collector can change this'}">${collector.listed ? 'Unlist' : 'List'}</button>
            </div>
            <details class="rs-disclosure rs-person-details">
              <summary>Verification</summary>
              <dl class="rs-kv rs-kv-compact">
                <div><dt>Collector ID</dt><dd>${collector.registrationTxHash ? transactionLink(collector.registrationTxHash, collector.did) : escapeHtml(collector.did)}</dd></div>
                <div><dt>Wallet address</dt><dd>${escapeHtml(collector.address)}</dd></div>
                ${latest && latest.metadataURI ? `<div><dt>Profile metadata</dt><dd>${escapeHtml(latest.metadataURI)}</dd></div>` : ''}
                <div><dt>Latest record</dt><dd>${transactionLink(collector.listingTxHash || (latest && latest.transactionHash) || collector.registrationTxHash)}</dd></div>
              </dl>
            </details>
          </article>`;
      }).join('');
    }

    document.querySelectorAll('[data-collector-listing]').forEach(button => {
      button.addEventListener('click', () => {
        const collector = state.collectors.find(item => sameAddress(item.address, button.dataset.collectorListing));
        if (collector) setProfileListed(!collector.listed).catch(() => {});
      });
    });
    document.querySelectorAll('[data-artwork-listing]').forEach(button => {
      button.addEventListener('click', () => {
        const artwork = state.artworks.find(item => sameAddress(item.erc721, button.dataset.artworkListing));
        if (!artwork) return;
        try { setArtworkListed(artwork, !artwork.listed).catch(() => {}); }
        catch (error) { showChainStatus(error.message, 'error'); }
      });
    });
  }

  function renderLedger() {
    const body = $('ledgerBody');
    $('transferCount').textContent = state.ledger.length || '';
    if (!state.ledger.length) {
      body.innerHTML = `<li class="rs-timeline-empty">${emptyState('No transfers yet. Completed resales appear here.')}</li>`;
      return;
    }
    body.innerHTML = state.ledger.map(r => {
      const art = state.artworks.find(p => sameAddress(p.erc721, r.artwork));
      return `
        <li class="rs-timeline-item">
          <span class="rs-timeline-dot" aria-hidden="true"></span>
          <div class="rs-timeline-body">
            ${art ? artImage(art, 'rs-timeline-thumb') : ''}
            <div>
              <strong>${art ? escapeHtml(art.title) : shorten(r.artwork)}</strong>
              <div class="rs-timeline-route">${partyChip(r.from)}<span class="rs-route-arrow" aria-label="to">→</span>${partyChip(r.to)}</div>
              <div class="rs-timeline-meta">${escapeHtml(r.time)} · ${transactionLink(r.transactionHash, 'View transaction')}</div>
            </div>
          </div>
        </li>`;
    }).join('');
  }

  /* ==========================================================================
     WebMCP

     Tools are published per page, so an agent only ever sees what the person
     could do on the current screen. Each result names the page it left the
     wallet on and the tools available there, because the set changes as the
     agent moves through the flow.
     ========================================================================== */

  function artworkSummary(p) {
    return {
      artworkId: p.artworkId,
      title: p.title,
      artist: p.artist || null,
      owner: ownerLabel(p.owner),
      ownerAddress: p.owner,
      listed: p.listed,
      idTokenContract: p.erc721,
      did: p.did,
      imageURI: p.imageURI || null
    };
  }

  /* Accept an artwork ID, an ID token contract address or an exact title.
     Re-registered works share a title, so a title prefers the listed record. */
  function findArtwork(ref, pool) {
    const text = String(ref || '').trim();
    if (!text) throw new Error('Name the artwork by its artworkId, ID token contract or title.');
    const list = pool || state.artworks;
    const exact = list.find(p => p.artworkId === text || sameAddress(p.erc721, text));
    if (exact) return exact;
    const byTitle = list.filter(p => p.title.toLowerCase() === text.toLowerCase());
    const listed = byTitle.filter(p => p.listed);
    if (listed.length === 1 || (byTitle.length === 1)) return listed[0] || byTitle[0];
    if (byTitle.length > 1) {
      throw new Error('Several artworks are titled "' + text + '". Use one of these artworkIds: ' + byTitle.map(p => p.artworkId).join(', '));
    }
    throw new Error('No artwork matches "' + text + '".');
  }

  function purchaseSummary() {
    if (!state.scanned) return { stage: state.stage };
    const p = piece(state.scanned.art);
    return {
      stage: state.stage,
      artwork: p ? p.title : state.scanned.art,
      priceHKD: Number(state.scanned.amount),
      seller: PEOPLE[state.scanned.seller].name,
      sellerReleaseNeedsPin: state.stage !== 'transferred' && !isConnected(state.scanned.seller),
      paymentMethod: state.channel,
      paymentReference: state.payRef,
      transferTx: state.txHash
    };
  }

  function walletSnapshot() {
    const a = state.account;
    const listing = myListing();
    const snapshot = {
      page: state.page,
      step: PAGES.indexOf(state.page) + 1 + ' of 4',
      user: state.user ? PEOPLE[state.user].name : null,
      region: state.user ? PEOPLE[state.user].region.name : null,
      role: state.role,
      transactionPending: state.busy,
      registrySynced: state.synced
    };
    if (a) {
      snapshot.wallet = {
        address: a.address,
        collectorId: a.did,
        displayName: a.displayName,
        registered: a.registered,
        listed: a.listed,
        artworks: ownedArtworks().map(p => ({ artworkId: p.artworkId, title: p.title, listed: p.listed }))
      };
    }
    if (state.role === 'artist') {
      snapshot.selectedArtwork = state.selected ? state.selected.title : null;
      snapshot.paymentCode = listing
        ? { artwork: piece(listing.art) && piece(listing.art).title, priceHKD: Number(listing.amount), payload: qrPayload(listing), lightening: state.lightening }
        : null;
    }
    if (state.role === 'collector') snapshot.purchase = purchaseSummary();
    // tools are published per page, so say where the others live
    snapshot.toolsByPage = {};
    PAGES.filter(page => page === state.page || canOpen(page)).forEach(page => {
      snapshot.toolsByPage[page] = TOOLS
        .filter(tool => tool.pages.includes(page) && (!tool.roles || tool.roles.includes(state.role)))
        .map(tool => tool.name);
    });
    return snapshot;
  }

  const ARTWORK_REF = { type: 'string', description: 'The artwork\'s artworkId exactly as returned by list_my_artworks or search_registry, its idTokenContract address, or its exact title.' };
  const CHAIN_NOTE = ' Signs a qBESU transaction: the wallet owner must approve it on screen, and confirmation can take about a minute.';

  const mandateApproval = Symbol('mandateApproval');
  const TOOLS = [
    {
      name: 'inspect_mandate',
      description: 'Read an on-chain transfer mandate and artwork approval for the current principal.',
      pages: ['wallet'],
      readOnly: true,
      inputSchema: { type: 'object', properties: { mandateId: { type: 'string' }, artwork: { type: 'string' } }, required: ['mandateId', 'artwork'] },
      run: args => inspectMandate(args.mandateId, args.artwork)
    },
    {
      name: 'execute_mandated_transfer',
      description: 'Transfer an approved artwork under a mandate. Payment is not enforced; direct transfers can bypass the mandate.' + CHAIN_NOTE,
      pages: ['wallet'],
      chain: true,
      inputSchema: { type: 'object', properties: { mandateId: { type: 'string' }, artwork: { type: 'string' } }, required: ['mandateId', 'artwork'] },
      confirm: async args => {
        const profile = state.user;
        const record = await mandateTransferDetails(args.mandateId, args.artwork);
        args[mandateApproval] = { record, profile };
        return mandateConfirmation(record);
      },
      run: args => executeMandatedTransfer(args.mandateId, args.artwork, args[mandateApproval].record, args[mandateApproval].profile)
    },
    {
      name: 'get_wallet_state',
      description: 'Read where the wallet is in its four steps (login, role, wallet, registry), who is logged in, their role, wallet details, artworks, and any payment code or purchase in progress. Call this first if unsure what to do next.',
      pages: PAGES,
      readOnly: true,
      run: () => walletSnapshot()
    },
    {
      name: 'list_accounts',
      description: 'List the accounts that can log in to this wallet.',
      pages: ['login'],
      readOnly: true,
      run: () => ({ accounts: PROFILES.map(p => ({ account: p, name: PEOPLE[p].name, region: PEOPLE[p].region.name })) })
    },
    {
      name: 'log_in',
      description: 'Step 1. Unlock Alice\'s or Bob\'s ICCHSM wallet with its PIN. Only use a PIN the user has given you. Next step: select_role.',
      pages: ['login'],
      inputSchema: {
        type: 'object',
        properties: {
          account: { type: 'string', enum: PROFILES, description: '"alice" (China GBA) or "bob" (Hong Kong).' },
          pin: { type: 'string', description: 'The wallet PIN the user provided.' }
        },
        required: ['account', 'pin']
      },
      run: args => {
        document.querySelector(`input[name="account"][value="${args.account}"]`).checked = true;
        return logIn(args.account, args.pin).then(result => ({ loggedIn: PEOPLE[result.account].name, address: result.address }));
      }
    },
    {
      name: 'select_role',
      description: 'Step 2. Use the wallet as an artist (register and sell artworks) or a collector (load a payment code, pay and receive artworks). Either person can take either role. Opens the wallet page.',
      pages: ['role', 'wallet', 'registry'],
      inputSchema: {
        type: 'object',
        properties: { role: { type: 'string', enum: ['artist', 'collector'] } },
        required: ['role']
      },
      run: args => { selectRole(args.role); return { role: args.role }; }
    },
    {
      name: 'log_out',
      description: 'Lock the wallet, clear its PIN from this session and return to the login page. Payment codes already created stay available to the other account.',
      pages: ['role', 'wallet', 'registry'],
      run: () => { const name = PEOPLE[state.user].name; logOut(); return { loggedOut: name }; }
    },
    {
      name: 'open_page',
      description: 'Move between the wallet (step 3) and the ArtID Registry (step 4), or back to role selection (step 2).',
      pages: ['role', 'wallet', 'registry'],
      inputSchema: {
        type: 'object',
        properties: { page: { type: 'string', enum: ['role', 'wallet', 'registry'] } },
        required: ['page']
      },
      run: args => { go(args.page); return { opened: args.page }; }
    },
    {
      name: 'list_my_artworks',
      description: 'List the artworks owned by the logged-in wallet.',
      pages: ['wallet'],
      readOnly: true,
      run: () => ({ artworks: ownedArtworks().map(artworkSummary) })
    },
    {
      name: 'create_payment_code',
      description: 'Artist: offer one of your artworks for sale. Selects it, sets the asking price and draws the payment QR code over the artwork. Only listed artworks can be sold, because unlisted ones cannot be transferred (list them in the registry first). The code carries only your wallet address; the artwork and price are linked to it in this wallet, and a new code replaces your previous one. Returns whether the code scans; use adjust_payment_code to tune it.',
      pages: ['wallet'],
      roles: ['artist'],
      inputSchema: {
        type: 'object',
        properties: {
          artwork: ARTWORK_REF,
          priceHKD: { type: 'number', minimum: 1, description: 'Asking price in Hong Kong dollars.' },
          lightening: { type: 'number', minimum: 0, maximum: 100, description: 'How much to lighten the artwork behind the code, 0-100. Default 70.' }
        },
        required: ['artwork', 'priceHKD']
      },
      run: async args => {
        selectPiece(findArtwork(args.artwork, ownedArtworks()));
        const listing = createListing(args.priceHKD);
        const scannable = typeof args.lightening === 'number' ? await setLightening(args.lightening) : await drawSellerQr();
        return { artwork: state.selected.title, priceHKD: Number(listing.amount), payload: qrPayload(listing), lightening: state.lightening, scannable: scannable };
      }
    },
    {
      name: 'adjust_payment_code',
      description: 'Artist: change how much the artwork behind the payment code is lightened (0 = richer artwork, 100 = easiest to scan) and report whether it still scans. Set richest: true instead to find the lowest value that scans and apply it plus a safety margin.',
      pages: ['wallet'],
      roles: ['artist'],
      inputSchema: {
        type: 'object',
        properties: {
          lightening: { type: 'number', minimum: 0, maximum: 100 },
          richest: { type: 'boolean', description: 'Search for the richest artwork that still scans.' },
          margin: { type: 'number', minimum: 0, maximum: 30, description: 'With richest: points added above the lowest scannable value. Default 5.' }
        }
      },
      run: async args => {
        if (!myListing()) throw new Error('Create a payment code first.');
        if (!args.richest) {
          if (typeof args.lightening !== 'number') throw new Error('Give a lightening value, or set richest: true.');
          return { lightening: Math.round(args.lightening), scannable: await setLightening(args.lightening) };
        }
        let lowest = null;
        for (let value = 0; value <= 100 && lowest === null; value += 1) {
          if (await setLightening(value)) lowest = value;
        }
        if (lowest === null) throw new Error('The code does not scan at any lightening over this artwork.');
        const chosen = Math.min(100, lowest + (typeof args.margin === 'number' ? Math.round(args.margin) : 5));
        return { lowestScannable: lowest, lightening: chosen, scannable: await setLightening(chosen) };
      }
    },
    {
      name: 'download_payment_code',
      description: 'Artist: save the payment code as a PNG to the user\'s device so it can be shared with the buyer.',
      pages: ['wallet'],
      roles: ['artist'],
      run: async () => {
        if (!myListing()) throw new Error('Create a payment code first.');
        return { savedAs: await savePaymentCode() };
      }
    },
    {
      name: 'cancel_payment_code',
      description: 'Artist: withdraw the current payment code, for example to change the price.',
      pages: ['wallet'],
      roles: ['artist'],
      run: () => { cancelListing(); return { cancelled: true }; }
    },
    {
      name: 'register_artwork',
      description: 'Artist: register a new artwork on qBESU as an ERC-721 ID token owned by this wallet. Artwork IDs must be unique; if artworkId is omitted it is derived from the title. To "edit" a work, register it under a new ID and unlist the old record.' + CHAIN_NOTE,
      pages: ['wallet'],
      roles: ['artist'],
      chain: true,
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', maxLength: 120 },
          artist: { type: 'string', maxLength: 120 },
          artworkId: { type: 'string', maxLength: 96 },
          imageURI: { type: 'string', maxLength: 512, description: 'https:// or ipfs:// image URL.' },
          contentHash: { type: 'string', maxLength: 128 }
        },
        required: ['title']
      },
      confirm: args => ({
        title: 'Register "' + args.title + '"?',
        detail: 'Creates a new artwork record and ID token in ' + PEOPLE[state.user].name + '’s wallet.',
        facts: { Title: args.title, Artist: args.artist || '—', 'Artwork ID': args.artworkId || 'Derived from the title' }
      }),
      run: args => registerArtwork(args)
    },
    {
      name: 'load_payment_code',
      description: 'Collector: load the seller\'s payment code, given as the text it decodes to ("ethereum:0x…" or a 0x address). Shows the artwork, seller and price. Next: pay.',
      pages: ['wallet'],
      roles: ['collector'],
      inputSchema: {
        type: 'object',
        properties: { code: { type: 'string', description: 'The decoded payment code, e.g. "ethereum:0xABC…".' } },
        required: ['code']
      },
      run: args => { acceptPaymentCode(args.code); return purchaseSummary(); }
    },
    {
      name: 'pay',
      description: 'Collector: pay for the loaded artwork. The payment is simulated in this demo; no money moves. Next: complete_transfer.',
      pages: ['wallet'],
      roles: ['collector'],
      inputSchema: {
        type: 'object',
        properties: { method: { type: 'string', enum: ['chain', 'card'], description: '"chain" = on-chain payment, "card" = Visa. Both are simulated.' } },
        required: ['method']
      },
      confirm: () => state.scanned && {
        simulated: true,
        title: 'Pay HK$ ' + fmt(Number(state.scanned.amount)) + '?',
        detail: 'Demo payment only. No money is taken.',
        facts: { Artwork: (piece(state.scanned.art) || {}).title || '—', Seller: PEOPLE[state.scanned.seller].name }
      },
      run: args => { pay(args.method); return purchaseSummary(); }
    },
    {
      name: 'complete_transfer',
      description: 'Collector: after paying, have the seller release the artwork so its ID token moves to this wallet. The seller signs with their own wallet; if they are not logged in on this device their PIN is required (only use one the user gave you); get_wallet_state reports this as purchase.sellerReleaseNeedsPin. The person at this device approves on screen on the seller\'s behalf. The new owner is read back from the chain before success is reported. If it is declined or fails, the purchase stays at "paid" and can be retried or cancelled with start_new_purchase.' + CHAIN_NOTE,
      pages: ['wallet'],
      roles: ['collector'],
      chain: true,
      inputSchema: {
        type: 'object',
        properties: { sellerPin: { type: 'string', description: 'The seller\'s wallet PIN, when the seller is not logged in here.' } }
      },
      confirm: () => state.scanned && {
        title: 'Transfer "' + ((piece(state.scanned.art) || {}).title || 'artwork') + '" to ' + PEOPLE[state.user].name + '?',
        detail: PEOPLE[state.scanned.seller].name + ' signs the ownership transfer on qBESU.',
        facts: { From: PEOPLE[state.scanned.seller].name, To: PEOPLE[state.user].name, Price: 'HK$ ' + fmt(Number(state.scanned.amount)) }
      },
      run: args => completeTransfer(args.sellerPin)
    },
    {
      name: 'start_new_purchase',
      description: 'Collector: cancel the current purchase so another payment code can be loaded. Payments in this demo are simulated, so nothing needs refunding.',
      pages: ['wallet'],
      roles: ['collector'],
      run: () => {
        if (state.stage === 'transferring') throw new Error('Wait for the transfer to confirm.');
        resetPurchase();
        renderBuyer();
        return { stage: state.stage };
      }
    },
    {
      name: 'register_profile',
      description: 'Register the logged-in wallet in the collector registry. Required once before trading.' + CHAIN_NOTE,
      pages: ['wallet'],
      chain: true,
      inputSchema: {
        type: 'object',
        properties: {
          displayName: { type: 'string', maxLength: 80 },
          metadataURI: { type: 'string', maxLength: 512 }
        },
        required: ['displayName']
      },
      confirm: args => ({ title: 'Register "' + args.displayName + '" as a collector?', detail: 'Adds this wallet to the public collector registry.', facts: { 'Display name': args.displayName } }),
      run: args => registerProfile(args.displayName, args.metadataURI)
    },
    {
      name: 'update_profile',
      description: 'Change the collector display name or profile metadata URI. The previous values stay in the public profile history.' + CHAIN_NOTE,
      pages: ['wallet'],
      chain: true,
      inputSchema: {
        type: 'object',
        properties: {
          displayName: { type: 'string', maxLength: 80 },
          metadataURI: { type: 'string', maxLength: 512 }
        },
        required: ['displayName']
      },
      confirm: args => ({ title: 'Update the profile?', detail: 'The old values stay visible in the profile history.', facts: { 'Display name': args.displayName, 'Metadata URI': args.metadataURI || '—' } }),
      run: args => updateProfile(args.displayName, args.metadataURI)
    },
    {
      name: 'set_profile_listed',
      description: 'List or unlist the logged-in collector. While unlisted the wallet cannot send, receive or register artworks.' + CHAIN_NOTE,
      pages: ['wallet', 'registry'],
      chain: true,
      inputSchema: { type: 'object', properties: { listed: { type: 'boolean' } }, required: ['listed'] },
      confirm: args => ({ title: (args.listed ? 'List ' : 'Unlist ') + PEOPLE[state.user].name + '?', detail: args.listed ? 'Trading resumes.' : 'Trading pauses until relisted.', facts: {} }),
      run: args => setProfileListed(args.listed)
    },
    {
      name: 'search_registry',
      description: 'Search the public ArtID Registry of artworks. Filters by text (title, artist or artwork ID), owner, and whether to include unlisted records. Unlisted artworks are paused by their owner and cannot be transferred; older versions of re-registered works are usually unlisted. Independent of the on-screen Hide unlisted switch.',
      pages: ['registry'],
      readOnly: true,
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          owner: { type: 'string', enum: ['anyone', 'me', 'alice', 'bob'] },
          includeUnlisted: { type: 'boolean', description: 'Default false.' }
        }
      },
      run: args => {
        const query = String(args.query || '').toLowerCase();
        const ownerAddress = args.owner === 'me' ? state.account && state.account.address
          : PROFILES.includes(args.owner) ? state.known[args.owner] : null;
        if (args.owner && args.owner !== 'anyone' && !ownerAddress) {
          throw new Error('The ' + args.owner + ' wallet address is not known yet. It is learnt when that account logs in.');
        }
        const results = state.artworks.filter(p =>
          (args.includeUnlisted || p.listed) &&
          (!ownerAddress || sameAddress(p.owner, ownerAddress)) &&
          (!query || [p.title, p.artist, p.artworkId].some(v => String(v || '').toLowerCase().includes(query))));
        return { total: results.length, artworks: results.map(artworkSummary) };
      }
    },
    {
      name: 'get_artwork',
      description: 'Full provenance for one artwork: IDs, owner, creator, content hash and transaction hashes.',
      pages: ['registry'],
      readOnly: true,
      inputSchema: { type: 'object', properties: { artwork: ARTWORK_REF }, required: ['artwork'] },
      run: args => {
        const p = findArtwork(args.artwork);
        return Object.assign(artworkSummary(p), {
          registeredBy: ownerLabel(p.creator),
          creatorAddress: p.creator,
          contentHash: p.contentHash || null,
          creationTx: p.creationTxHash || null,
          latestTransferTx: p.transferTxHash || null,
          listingTx: p.listingTxHash || null
        });
      }
    },
    {
      name: 'list_collectors',
      description: 'List registered collectors with their region, address and listing status.',
      pages: ['registry'],
      readOnly: true,
      run: () => ({
        collectors: state.collectors.map(c => ({
          displayName: c.displayName,
          region: (regionForAddress(c.address) || {}).name || null,
          address: c.address,
          collectorId: c.did,
          listed: c.listed
        }))
      })
    },
    {
      name: 'get_ownership_history',
      description: 'Recent artwork ownership transfers, newest first.',
      pages: ['registry'],
      readOnly: true,
      inputSchema: { type: 'object', properties: { limit: { type: 'number', minimum: 1, maximum: 100, description: 'Default 10.' } } },
      run: args => ({
        transfers: state.ledger.slice(0, Math.round(args.limit || 10)).map(r => {
          const art = state.artworks.find(p => sameAddress(p.erc721, r.artwork));
          return { artwork: art ? art.title : r.artwork, from: ownerLabel(r.from), to: ownerLabel(r.to), time: r.time, tx: r.transactionHash };
        })
      })
    },
    {
      name: 'set_hide_unlisted',
      description: 'Show or hide unlisted artworks in the registry view, so re-registered works do not appear twice.',
      pages: ['registry'],
      inputSchema: { type: 'object', properties: { hide: { type: 'boolean' } }, required: ['hide'] },
      run: args => { setHideUnlisted(args.hide); return { hideUnlisted: state.hideUnlisted }; }
    },
    {
      name: 'refresh_registry',
      description: 'Reload artworks, collectors and transfers from qBESU.',
      pages: ['registry'],
      run: () => refreshRegistry().then(() => ({ artworks: state.artworks.length, collectors: state.collectors.length, transfers: state.ledger.length }))
    },
    {
      name: 'set_artwork_listed',
      description: 'List or unlist an artwork owned by the logged-in wallet. Unlisted artworks cannot be transferred.' + CHAIN_NOTE,
      pages: ['registry'],
      chain: true,
      inputSchema: {
        type: 'object',
        properties: { artwork: ARTWORK_REF, listed: { type: 'boolean' } },
        required: ['artwork', 'listed']
      },
      confirm: args => {
        const p = findArtwork(args.artwork);
        return { title: (args.listed ? 'List "' : 'Unlist "') + p.title + '"?', detail: args.listed ? 'It can be sold again.' : 'It cannot be transferred while unlisted.', facts: { Artwork: p.title, 'Artwork ID': p.artworkId } };
      },
      run: args => setArtworkListed(findArtwork(args.artwork), args.listed)
    }
  ];

  function availableTools() {
    return TOOLS.filter(tool => tool.pages.includes(state.page) && (!tool.roles || tool.roles.includes(state.role)));
  }

  const EMPTY_SCHEMA = { type: 'object', properties: {} };

  /* Light checks against the declared schema, so a bad call gets a clear
     message rather than a confusing failure further in. */
  function checkArgs(tool, args) {
    const schema = tool.inputSchema || EMPTY_SCHEMA;
    (schema.required || []).forEach(key => {
      if (args[key] === undefined || args[key] === null || args[key] === '') throw new Error('"' + key + '" is required.');
    });
    Object.keys(schema.properties || {}).forEach(key => {
      const rule = schema.properties[key];
      const value = args[key];
      if (value === undefined) return;
      if (rule.type === 'number' && typeof value !== 'number') throw new Error('"' + key + '" must be a number.');
      if (rule.type === 'boolean' && typeof value !== 'boolean') throw new Error('"' + key + '" must be true or false.');
      if (rule.type === 'string' && typeof value !== 'string') throw new Error('"' + key + '" must be a string.');
      if (rule.enum && !rule.enum.includes(value)) throw new Error('"' + key + '" must be one of: ' + rule.enum.join(', ') + '.');
      if (typeof rule.minimum === 'number' && value < rule.minimum) throw new Error('"' + key + '" must be at least ' + rule.minimum + '.');
      if (typeof rule.maximum === 'number' && value > rule.maximum) throw new Error('"' + key + '" must be at most ' + rule.maximum + '.');
    });
  }

  /* ---- the person stays in control: approvals and activity ---- */

  let pendingApproval = null;

  function askPerson(request) {
    if (pendingApproval) throw new Error('Another confirmation is already in progress.');
    const dialog = $('agentConfirm');
    $('confirmTitle').textContent = request.title;
    $('confirmDetail').textContent = request.detail || '';
    $('confirmFacts').innerHTML = Object.keys(request.facts || {}).map(key =>
      `<div><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(request.facts[key])}</dd></div>`).join('');
    // lets a test harness tell a simulated step from a real signature
    dialog.dataset.kind = request.simulated ? 'simulated' : 'chain';
    $('confirmApprove').textContent = request.simulated ? 'Approve' : 'Approve and sign';
    return new Promise(resolve => {
      pendingApproval = resolve;
      if (!dialog.open) dialog.showModal();
      $('confirmDecline').focus();
    });
  }

  function answerApproval(approved) {
    const dialog = $('agentConfirm');
    if (dialog.open) dialog.close();
    if (pendingApproval) {
      const resolve = pendingApproval;
      pendingApproval = null;
      resolve(approved);
    }
  }

  const activity = [];

  function logActivity(entry) {
    activity.unshift(entry);
    activity.length = Math.min(activity.length, 30);
    renderAgentPanel();
  }

  const redact = args => {
    const copy = Object.assign({}, args);
    ['pin', 'sellerPin'].forEach(key => { if (key in copy) copy[key] = '••••'; });
    return copy;
  };

  function nativeContext() {
    const mc = navigator.modelContext;
    return mc && (typeof mc.provideContext === 'function' || typeof mc.registerTool === 'function') ? mc : null;
  }

  function renderAgentPanel() {
    $('agentMode').textContent = nativeContext()
      ? 'This browser supports WebMCP. The tools below are published through navigator.modelContext; any connected agent can call them.'
      : 'This browser does not expose navigator.modelContext. The same tools are available to agent bridges at window.webmcpWallet (listTools, callTool).';
    const tools = availableTools();
    $('agentToolCount').textContent = '(' + tools.length + ')';
    $('agentTools').innerHTML = tools.map(tool =>
      `<li><code>${escapeHtml(tool.name)}</code>${tool.chain ? '<span class="rs-pill is-muted">Signs</span>' : ''}<span>${escapeHtml(tool.description)}</span></li>`).join('');
    $('agentActivity').innerHTML = activity.length
      ? activity.map(item => `<li class="is-${item.status}"><span class="wm-activity-time">${escapeHtml(item.time)}</span><code>${escapeHtml(item.name)}</code><span>${escapeHtml(item.note)}</span></li>`).join('')
      : '<li class="wm-activity-empty">No agent activity yet.</li>';
  }

  function textResult(value, isError) {
    return { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }], isError: Boolean(isError) };
  }

  let running = 0;

  async function callTool(name, rawArgs, client) {
    const args = rawArgs && typeof rawArgs === 'object' ? Object.assign({}, rawArgs) : {};
    const tool = availableTools().find(item => item.name === name);
    const entry = { time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }), name: name, note: JSON.stringify(redact(args)), status: 'running' };
    if (!tool) {
      entry.status = 'error';
      entry.note = 'Not available on this page';
      logActivity(entry);
      return textResult({
        error: 'Tool "' + name + '" is not available on the ' + state.page + ' page.',
        page: state.page,
        availableTools: availableTools().map(item => item.name)
      }, true);
    }
    logActivity(entry);
    running += 1;
    document.body.classList.add('wm-agent-working');
    try {
      checkArgs(tool, args);
      if (!tool.readOnly) showChainStatus('AI agent: ' + name.replace(/_/g, ' ') + '.', 'info');
      const request = tool.confirm && await tool.confirm(args);
      if (request) {
        let onScreenApproved = false;
        const show = async () => {
          onScreenApproved = await askPerson(request);
          return onScreenApproved;
        };
        const approved = client && typeof client.requestUserInteraction === 'function'
          ? await client.requestUserInteraction(show)
          : await show();
        if (!approved || !onScreenApproved) throw new Error('The person at this device did not approve "' + request.title + '" on screen. Nothing was signed or changed. Do not retry unless they ask you to.');
      }
      const result = await tool.run(args);
      entry.status = 'done';
      entry.note = tool.readOnly ? 'Read' : 'Done';
      renderAgentPanel();
      return textResult(Object.assign({ ok: true }, result, {
        page: state.page,
        availableTools: availableTools().map(item => item.name)
      }));
    } catch (error) {
      entry.status = 'error';
      entry.note = error.message;
      renderAgentPanel();
      return textResult({ ok: false, error: error.message, page: state.page, availableTools: availableTools().map(item => item.name) }, true);
    } finally {
      running -= 1;
      if (!running) document.body.classList.remove('wm-agent-working');
    }
  }

  function describeTool(tool) {
    return {
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema || EMPTY_SCHEMA,
      annotations: { readOnlyHint: Boolean(tool.readOnly) }
    };
  }

  let registered = [];

  /* Publish this page's tools. provideContext replaces the whole set; on the
     older register/unregister API the previous page's tools are removed first. */
  function publishTools() {
    const tools = availableTools().map(tool => Object.assign(describeTool(tool), {
      execute: (args, client) => callTool(tool.name, args, client)
    }));
    const mc = nativeContext();
    if (mc) {
      try {
        if (typeof mc.provideContext === 'function') {
          mc.provideContext({ tools: tools });
        } else {
          registered.forEach(item => {
            if (item && typeof item.unregister === 'function') item.unregister();
            else if (typeof mc.unregisterTool === 'function') mc.unregisterTool(item);
          });
          registered = tools.map(tool => mc.registerTool(tool) || tool.name);
        }
      } catch (error) {
        console.error('WebMCP: could not publish tools', error);
      }
    }
    renderAgentPanel();
    window.dispatchEvent(new CustomEvent('webmcp:toolschange', { detail: { page: state.page, tools: tools.map(t => t.name) } }));
  }

  // For agent bridges and tests in browsers without navigator.modelContext.
  // listAllTools is for MCP clients that read the tool list once: every tool,
  // with where it can be used, while calls stay limited to the current page.
  window.webmcpWallet = Object.freeze({
    listTools: () => availableTools().map(describeTool),
    listAllTools: () => TOOLS.map(tool => Object.assign(describeTool(tool), {
      description: '[' + (tool.pages.length === PAGES.length ? 'any page' : tool.pages.join('/') + ' page') +
        (tool.roles ? ', ' + tool.roles.join('/') + ' role' : '') + '] ' + tool.description
    })),
    callTool: (name, args) => callTool(name, args, null),
    getState: () => walletSnapshot()
  });

  /* ---------------- boot ---------------- */

  window.addEventListener('DOMContentLoaded', () => {
    $('loginForm').addEventListener('submit', event => {
      event.preventDefault();
      const account = document.querySelector('input[name="account"]:checked');
      const pin = $('pinInput');
      if (!pin.value.trim()) {
        pin.setCustomValidity('Enter the wallet PIN.');
        pin.reportValidity();
        pin.focus();
        return;
      }
      pin.setCustomValidity('');
      logIn(account ? account.value : '', pin.value).catch(error => {
        showChainStatus(error.message, 'error');
        pin.focus();
      });
    });
    $('pinInput').addEventListener('input', event => event.target.setCustomValidity(''));
    document.querySelectorAll('[data-role]').forEach(button =>
      button.addEventListener('click', () => selectRole(button.dataset.role)));
    document.querySelectorAll('[data-step]').forEach(button =>
      button.addEventListener('click', () => {
        try { go(button.dataset.step); } catch (error) { showChainStatus(error.message, 'info'); }
      }));
    $('logoutBtn').addEventListener('click', () => {
      try { logOut(); } catch (error) { showChainStatus(error.message, 'error'); }
    });
    $('toRegistryBtn').addEventListener('click', () => go('registry'));
    $('backToWalletBtn').addEventListener('click', () => go('wallet'));
    $('refreshChainBtn').addEventListener('click', () => refreshRegistry().catch(() => {}));
    $('hideUnlistedToggle').addEventListener('click', () => setHideUnlisted(!state.hideUnlisted));
    $('createArtworkBtn').addEventListener('click', registerArtworkFromForm);
    $('agentMandateRead').addEventListener('click', () => handleMandate('read'));
    $('agentMandateExecute').addEventListener('click', () => handleMandate('execute'));
    $('registerProfileBtn').addEventListener('click', () =>
      registerProfile($('displayNameInput').value, $('metadataInput').value).catch(() => {}));
    $('saveProfileBtn').addEventListener('click', () =>
      updateProfile($('displayNameInput').value, $('metadataInput').value).catch(() => {}));
    $('profileListingToggle').addEventListener('click', () => {
      if (state.account) setProfileListed(!state.account.listed).catch(() => {});
    });
    $('copyAddressBtn').addEventListener('click', async () => {
      const button = $('copyAddressBtn');
      if (!state.account) return;
      try {
        await navigator.clipboard.writeText(state.account.address);
        button.classList.add('is-copied');
        button.setAttribute('aria-label', 'Copied');
        setTimeout(() => {
          button.classList.remove('is-copied');
          button.setAttribute('aria-label', 'Copy wallet address');
        }, 1600);
      } catch (error) {
        showChainStatus('Could not copy the address. It is ' + state.account.address, 'error');
      }
    });
    $('agentBtn').addEventListener('click', () => { renderAgentPanel(); $('agentPanel').showModal(); });
    // flip the knob, then open the human wallet once it has slid across
    $('modeSwitch').addEventListener('click', event => {
      const toggle = event.currentTarget;
      toggle.setAttribute('aria-checked', String(toggle.getAttribute('aria-checked') !== 'true'));
      setTimeout(() => { location.href = toggle.dataset.href; }, 220);
    });
    $('confirmApprove').addEventListener('click', () => answerApproval(true));
    $('confirmDecline').addEventListener('click', () => answerApproval(false));
    // Escape closes the dialog; treat that as a decline, never an approval
    $('agentConfirm').addEventListener('cancel', () => answerApproval(false));

    state.hideUnlisted = readHideUnlisted();
    go('login', { focus: false });
    // load the public registry up front so the wallet opens quickly after log in
    refreshChainState().catch(error => {
      markSynced(false);
      console.error('Registry preload failed:', error);
    });
  });
})();
