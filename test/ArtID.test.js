const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Art ID contracts", function () {
  async function deploySystem() {
    const [artistAccount, collectorAccount, stranger] = await ethers.getSigners();
    const CollectorRegistry = await ethers.getContractFactory("ArtIDCollectorRegistry");
    const collectors = await CollectorRegistry.deploy();
    const Factory = await ethers.getContractFactory("ArtIDFactory");
    const factory = await Factory.deploy(await collectors.getAddress());
    return { artistAccount, collectorAccount, stranger, collectors, factory };
  }

  it("derives collector DIDs from the registering EOA and restricts metadata writes", async function () {
    const { artistAccount, stranger, collectors } = await deploySystem();
    await collectors.connect(artistAccount).register("Artist Alice", "ipfs://collector/artist-alice");

    const record = await collectors.getCollector(artistAccount.address);
    expect(record.registered).to.equal(true);
    expect(record.listed).to.equal(true);
    expect(record.did).to.equal(`did:art:collector:${artistAccount.address.toLowerCase()}`);
    expect(record.displayName).to.equal("Artist Alice");
    await collectors.connect(artistAccount).updateMetadata("Artist Alice Collector", "ipfs://collector/artist-alice-v2");
    const updated = await collectors.getCollector(artistAccount.address);
    expect(updated.displayName).to.equal("Artist Alice Collector");
    expect(updated.metadataURI).to.equal("ipfs://collector/artist-alice-v2");
    await expect(collectors.connect(stranger).updateMetadata("Mallory", ""))
      .to.be.revertedWith("Collector not registered");
  });

  it("creates one artwork contract with readable metadata and the contract-address DID", async function () {
    const { artistAccount, collectors, factory } = await deploySystem();
    await collectors.connect(artistAccount).register("Artist Alice", "");
    const tx = await factory.connect(artistAccount).createArtwork(
      "ART-101",
      "Blue Study",
      "A. Artist",
      "ipfs://art/101",
      "sha256:example"
    );
    const receipt = await tx.wait();
    expect(receipt.gasUsed).to.be.lessThan(5_000_000n);
    const event = receipt.logs
      .map((log) => {
        try { return factory.interface.parseLog(log); } catch { return null; }
      })
      .find((log) => log && log.name === "ArtworkCreated");

    expect(event.args.creator).to.equal(artistAccount.address);
    expect(event.args.tokenId).to.equal(1n);
    expect(await factory.artworkCount()).to.equal(1n);
    expect(await factory.artworkAt(0)).to.equal(event.args.artworkContract);

    const artwork = await ethers.getContractAt("ArtIDArtwork", event.args.artworkContract);
    const metadata = await artwork.metadata();
    expect(metadata.title).to.equal("Blue Study");
    expect(metadata.artist).to.equal("A. Artist");
    expect(metadata.creator).to.equal(artistAccount.address);
    expect(await artwork.ownerOf(1)).to.equal(artistAccount.address);
    expect(await artwork.isListed()).to.equal(true);
    expect(await artwork.artworkDid()).to.equal(
      `did:art:artwork:${event.args.artworkContract.toLowerCase()}`
    );
  });

  it("rejects duplicate artwork identifiers", async function () {
    const { artistAccount, collectors, factory } = await deploySystem();
    await collectors.connect(artistAccount).register("Artist Alice", "");
    const args = ["ART-101", "Blue Study", "A. Artist", "", ""];
    await factory.connect(artistAccount).createArtwork(...args);
    await expect(factory.connect(artistAccount).createArtwork(...args))
      .to.be.revertedWith("Artwork ID already used");
  });

  it("allows only the token owner to transfer token 1", async function () {
    const { artistAccount, collectorAccount, stranger, collectors, factory } = await deploySystem();
    await collectors.connect(artistAccount).register("Artist Alice", "");
    await collectors.connect(collectorAccount).register("Collector Bob", "");
    await factory.connect(artistAccount).createArtwork("ART-101", "Blue Study", "A. Artist", "", "");
    const address = await factory.artworkAt(0);
    const artwork = await ethers.getContractAt("ArtIDArtwork", address);

    await expect(artwork.connect(stranger).safeTransferFrom(artistAccount.address, collectorAccount.address, 1))
      .to.be.reverted;
    await artwork.connect(artistAccount).safeTransferFrom(artistAccount.address, collectorAccount.address, 1);
    expect(await artwork.ownerOf(1)).to.equal(collectorAccount.address);
  });

  it("rejects an ERC-721 ID Token transfer to an unregistered address", async function () {
    const { artistAccount, collectorAccount, collectors, factory } = await deploySystem();
    await collectors.connect(artistAccount).register("Artist Alice", "");
    await factory.connect(artistAccount).createArtwork("ART-101", "Blue Study", "A. Artist", "", "");
    const artwork = await ethers.getContractAt("ArtIDArtwork", await factory.artworkAt(0));
    await expect(artwork.connect(artistAccount).safeTransferFrom(artistAccount.address, collectorAccount.address, 1))
      .to.be.revertedWith("Receiver is not a registered collector");
  });

  it("requires a registered collector to create artwork", async function () {
    const { artistAccount, factory } = await deploySystem();
    await expect(factory.connect(artistAccount).createArtwork("ART-101", "Blue Study", "A. Artist", "", ""))
      .to.be.revertedWith("Collector not registered");
  });

  it("enumerates collectors and lets each collector change only their own listing status", async function () {
    const { artistAccount, collectorAccount, stranger, collectors } = await deploySystem();
    await collectors.connect(artistAccount).register("Artist Alice", "");
    await collectors.connect(collectorAccount).register("Collector Bob", "");

    expect(await collectors.collectorCount()).to.equal(2n);
    expect(await collectors.collectorAt(0)).to.equal(artistAccount.address);
    expect(await collectors.collectorAt(1)).to.equal(collectorAccount.address);
    expect(await collectors.isListed(artistAccount.address)).to.equal(true);

    await expect(collectors.connect(stranger).setListed(false))
      .to.be.revertedWith("Collector not registered");
    await collectors.connect(artistAccount).setListed(false);
    expect(await collectors.isListed(artistAccount.address)).to.equal(false);
    await expect(collectors.connect(artistAccount).setListed(false))
      .to.be.revertedWith("Listing status unchanged");
    await collectors.connect(artistAccount).setListed(true);
    expect(await collectors.isListed(artistAccount.address)).to.equal(true);
  });

  it("blocks an unlisted collector from creating artwork and lets them relist", async function () {
    const { artistAccount, collectors, factory } = await deploySystem();
    await collectors.connect(artistAccount).register("Artist Alice", "");
    await collectors.connect(artistAccount).setListed(false);
    await expect(factory.connect(artistAccount).createArtwork("ART-101", "Blue Study", "A. Artist", "", ""))
      .to.be.revertedWith("Collector is unlisted");
    await collectors.connect(artistAccount).setListed(true);
    await factory.connect(artistAccount).createArtwork("ART-101", "Blue Study", "A. Artist", "", "");
  });

  it("lets only the current owner list or unlist an artwork", async function () {
    const { artistAccount, collectorAccount, stranger, collectors, factory } = await deploySystem();
    await collectors.connect(artistAccount).register("Artist Alice", "");
    await collectors.connect(collectorAccount).register("Collector Bob", "");
    await factory.connect(artistAccount).createArtwork("ART-101", "Blue Study", "A. Artist", "", "");
    const artwork = await ethers.getContractAt("ArtIDArtwork", await factory.artworkAt(0));

    await expect(artwork.connect(stranger).setListed(false))
      .to.be.revertedWith("Only current owner can change listing");
    await artwork.connect(artistAccount).setListed(false);
    expect(await artwork.isListed()).to.equal(false);
    await expect(artwork.connect(artistAccount).safeTransferFrom(artistAccount.address, collectorAccount.address, 1))
      .to.be.revertedWith("Artwork is unlisted");

    await artwork.connect(artistAccount).setListed(true);
    await artwork.connect(artistAccount).safeTransferFrom(artistAccount.address, collectorAccount.address, 1);
    await expect(artwork.connect(artistAccount).setListed(false))
      .to.be.revertedWith("Only current owner can change listing");
    await artwork.connect(collectorAccount).setListed(false);
    expect(await artwork.isListed()).to.equal(false);
  });

  it("prevents transfer to an unlisted collector", async function () {
    const { artistAccount, collectorAccount, collectors, factory } = await deploySystem();
    await collectors.connect(artistAccount).register("Artist Alice", "");
    await collectors.connect(collectorAccount).register("Collector Bob", "");
    await factory.connect(artistAccount).createArtwork("ART-101", "Blue Study", "A. Artist", "", "");
    await collectors.connect(collectorAccount).setListed(false);
    const artwork = await ethers.getContractAt("ArtIDArtwork", await factory.artworkAt(0));
    await expect(artwork.connect(artistAccount).safeTransferFrom(artistAccount.address, collectorAccount.address, 1))
      .to.be.revertedWith("Receiver is unlisted");
  });

  it("prevents an unlisted owner from transferring until they relist", async function () {
    const { artistAccount, collectorAccount, collectors, factory } = await deploySystem();
    await collectors.connect(artistAccount).register("Artist Alice", "");
    await collectors.connect(collectorAccount).register("Collector Bob", "");
    await factory.connect(artistAccount).createArtwork("ART-101", "Blue Study", "A. Artist", "", "");
    const artwork = await ethers.getContractAt("ArtIDArtwork", await factory.artworkAt(0));

    await collectors.connect(artistAccount).setListed(false);
    await expect(artwork.connect(artistAccount).safeTransferFrom(artistAccount.address, collectorAccount.address, 1))
      .to.be.revertedWith("Sender is unlisted");
    await collectors.connect(artistAccount).setListed(true);
    await artwork.connect(artistAccount).safeTransferFrom(artistAccount.address, collectorAccount.address, 1);
    expect(await artwork.ownerOf(1)).to.equal(collectorAccount.address);
  });

  it("prevents an unlisted collector from registering artwork", async function () {
    const { artistAccount, collectors, factory } = await deploySystem();
    await collectors.connect(artistAccount).register("Artist Alice", "");
    await collectors.connect(artistAccount).setListed(false);
    await expect(factory.connect(artistAccount).createArtwork("ART-101", "Blue Study", "A. Artist", "", ""))
      .to.be.revertedWith("Collector is unlisted");
  });
});
