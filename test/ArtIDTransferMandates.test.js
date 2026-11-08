const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

describe("ArtID mandate transfers", function () {
  async function deploySystem() {
    const [principal, recipient, stranger] = await ethers.getSigners();
    const collectors = await (await ethers.getContractFactory("ArtIDCollectorRegistry")).deploy();
    await collectors.connect(principal).register("Artist", "");
    await collectors.connect(recipient).register("Collector", "");
    const factory = await (await ethers.getContractFactory("ArtIDFactory")).deploy(await collectors.getAddress());
    await factory.connect(principal).createArtwork("ART-1", "First", "Artist", "", "");
    await factory.connect(principal).createArtwork("ART-2", "Second", "Artist", "", "");
    const artworks = await Promise.all([0, 1].map(async index =>
      ethers.getContractAt("ArtIDArtwork", await factory.artworkAt(index))
    ));
    const mandates = await (await ethers.getContractFactory("ArtIDTransferMandates")).deploy();
    const expiry = (await time.latest()) + 3600;
    return { principal, recipient, stranger, collectors, artworks, mandates, expiry };
  }

  it("creates a scoped mandate and transfers multiple permitted artworks", async function () {
    const { principal, recipient, artworks, mandates, expiry } = await loadFixture(deploySystem);
    const addresses = await Promise.all(artworks.map(a => a.getAddress()));
    await expect(mandates.connect(principal).createMandate(recipient.address, addresses, expiry, 2))
      .to.emit(mandates, "MandateCreated")
      .withArgs(1, principal.address, recipient.address, expiry, 2, addresses);
    for (const artwork of artworks) await artwork.connect(principal).approve(await mandates.getAddress(), 1);
    await expect(mandates.connect(principal).executeTransfer(1, addresses[0]))
      .to.emit(mandates, "MandateTransfer").withArgs(1, addresses[0], recipient.address, 1);
    await mandates.connect(principal).executeTransfer(1, addresses[1]);
    expect(await artworks[0].ownerOf(1)).to.equal(recipient.address);
    expect(await artworks[1].ownerOf(1)).to.equal(recipient.address);
    expect((await mandates.mandates(1)).remainingTransfers).to.equal(0);
    await expect(mandates.connect(principal).executeTransfer(1, addresses[0]))
      .to.be.revertedWith("Transfer limit reached");
  });

  it("rejects invalid mandate parameters and duplicates without consuming an id", async function () {
    const { principal, recipient, stranger, artworks, mandates } = await loadFixture(deploySystem);
    const address = await artworks[0].getAddress();
    const now = await time.latest();
    const create = (to, items, expiry, limit) => mandates.connect(principal).createMandate(to, items, expiry, limit);
    await expect(create(ethers.ZeroAddress, [address], now + 3600, 1)).to.be.revertedWith("Invalid recipient");
    await expect(create(principal.address, [address], now + 3600, 1)).to.be.revertedWith("Invalid recipient");
    await expect(create(recipient.address, [address], now, 1)).to.be.revertedWith("Expiry must be in the future");
    await expect(create(recipient.address, [address], now + 3600, 0)).to.be.revertedWith("Invalid transfer limit");
    await expect(create(recipient.address, [], now + 3600, 1)).to.be.revertedWith("Invalid artwork count");
    await expect(create(recipient.address, Array(101).fill(address), now + 3600, 1)).to.be.revertedWith("Invalid artwork count");
    await expect(create(recipient.address, [stranger.address], now + 3600, 1)).to.be.revertedWith("Artwork must be a contract");
    await expect(create(recipient.address, [address, address], now + 3600, 1)).to.be.revertedWith("Duplicate artwork");
    expect(await mandates.nextMandateId()).to.equal(1);
  });

  it("limits execution to the principal and the approved artwork", async function () {
    const { principal, recipient, stranger, artworks, mandates, expiry } = await loadFixture(deploySystem);
    const first = await artworks[0].getAddress();
    const second = await artworks[1].getAddress();
    await mandates.connect(principal).createMandate(recipient.address, [first], expiry, 2);
    await artworks[0].connect(principal).approve(await mandates.getAddress(), 1);
    await expect(mandates.connect(stranger).executeTransfer(1, first)).to.be.revertedWith("Only principal");
    await expect(mandates.connect(principal).executeTransfer(1, second)).to.be.revertedWith("Artwork not permitted");
    expect((await mandates.mandates(1)).remainingTransfers).to.equal(2);
    expect(await mandates.permittedArtwork(1, first)).to.equal(true);
    expect(await mandates.permittedArtwork(1, second)).to.equal(false);
  });

  it("requires ERC-721 approval and restores the limit when a transfer fails", async function () {
    const { principal, recipient, artworks, mandates, expiry } = await loadFixture(deploySystem);
    const address = await artworks[0].getAddress();
    await mandates.connect(principal).createMandate(recipient.address, [address], expiry, 1);
    await expect(mandates.connect(principal).executeTransfer(1, address)).to.be.reverted;
    expect((await mandates.mandates(1)).remainingTransfers).to.equal(1);
    await artworks[0].connect(principal).approve(await mandates.getAddress(), 1);
    await artworks[0].connect(principal).setListed(false);
    await expect(mandates.connect(principal).executeTransfer(1, address)).to.be.revertedWith("Artwork is unlisted");
    expect((await mandates.mandates(1)).remainingTransfers).to.equal(1);
    await artworks[0].connect(principal).setListed(true);
    await mandates.connect(principal).executeTransfer(1, address);
    expect(await artworks[0].ownerOf(1)).to.equal(recipient.address);
  });

  it("permits only the principal to revoke and blocks revoked mandates", async function () {
    const { principal, recipient, stranger, artworks, mandates, expiry } = await loadFixture(deploySystem);
    const address = await artworks[0].getAddress();
    await mandates.connect(principal).createMandate(recipient.address, [address], expiry, 1);
    await expect(mandates.connect(stranger).revokeMandate(1)).to.be.revertedWith("Only principal");
    await expect(mandates.connect(principal).revokeMandate(1))
      .to.emit(mandates, "MandateRevoked").withArgs(1, principal.address);
    await expect(mandates.connect(principal).revokeMandate(1)).to.be.revertedWith("Already revoked");
    await expect(mandates.connect(principal).executeTransfer(1, address)).to.be.revertedWith("Mandate revoked");
    await expect(mandates.connect(principal).executeTransfer(99, address)).to.be.revertedWith("Only principal");
  });

  it("expires exactly at the specified timestamp", async function () {
    const { principal, recipient, artworks, mandates, expiry } = await loadFixture(deploySystem);
    const address = await artworks[0].getAddress();
    await mandates.connect(principal).createMandate(recipient.address, [address], expiry, 1);
    await artworks[0].connect(principal).approve(await mandates.getAddress(), 1);
    await time.setNextBlockTimestamp(expiry);
    await expect(mandates.connect(principal).executeTransfer(1, address)).to.be.revertedWith("Mandate expired");
    expect(await artworks[0].ownerOf(1)).to.equal(principal.address);
  });

  it("accepts a transfer just before expiry", async function () {
    const { principal, recipient, artworks, mandates, expiry } = await loadFixture(deploySystem);
    const address = await artworks[0].getAddress();
    await mandates.connect(principal).createMandate(recipient.address, [address], expiry, 1);
    await artworks[0].connect(principal).approve(await mandates.getAddress(), 1);
    await time.setNextBlockTimestamp(expiry - 1);
    await mandates.connect(principal).executeTransfer(1, address);
    expect(await artworks[0].ownerOf(1)).to.equal(recipient.address);
  });

  it("preserves qBESU collector listing restrictions", async function () {
    const { principal, recipient, collectors, artworks, mandates, expiry } = await loadFixture(deploySystem);
    const address = await artworks[0].getAddress();
    await mandates.connect(principal).createMandate(recipient.address, [address], expiry, 1);
    await artworks[0].connect(principal).approve(await mandates.getAddress(), 1);
    await collectors.connect(recipient).setListed(false);
    await expect(mandates.connect(principal).executeTransfer(1, address))
      .to.be.revertedWith("Receiver is unlisted");
    expect((await mandates.mandates(1)).remainingTransfers).to.equal(1);
    await collectors.connect(recipient).setListed(true);
    await collectors.connect(principal).setListed(false);
    await expect(mandates.connect(principal).executeTransfer(1, address))
      .to.be.revertedWith("Sender is unlisted");
    expect((await mandates.mandates(1)).remainingTransfers).to.equal(1);
  });

  it("allows independent mandates without extending or changing previous ones", async function () {
    const { principal, recipient, artworks, mandates, expiry } = await loadFixture(deploySystem);
    const address = await artworks[0].getAddress();
    await mandates.connect(principal).createMandate(recipient.address, [address], expiry, 1);
    await mandates.connect(principal).createMandate(recipient.address, [address], expiry + 100, 2);
    await mandates.connect(principal).revokeMandate(1);
    expect((await mandates.mandates(1)).revoked).to.equal(true);
    expect((await mandates.mandates(2)).revoked).to.equal(false);
    expect((await mandates.mandates(2)).remainingTransfers).to.equal(2);
    await artworks[0].connect(principal).approve(await mandates.getAddress(), 1);
    await mandates.connect(principal).executeTransfer(2, address);
    expect((await mandates.mandates(2)).remainingTransfers).to.equal(1);
  });

  it("does not prevent direct owner transfers outside the mandate contract", async function () {
    const { principal, recipient, artworks, mandates, expiry } = await loadFixture(deploySystem);
    const address = await artworks[0].getAddress();
    await mandates.connect(principal).createMandate(recipient.address, [address], expiry, 1);
    await mandates.connect(principal).revokeMandate(1);
    await artworks[0].connect(principal).safeTransferFrom(principal.address, recipient.address, 1);
    expect(await artworks[0].ownerOf(1)).to.equal(recipient.address);
  });
});
