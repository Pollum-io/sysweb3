import { changeNetwork } from '../provider/web3Provider';
import { getUserNFT, getNFTImage } from './web3-nft';

describe('web3-NFT tests', () => {
  it('should check NFT url', async () => {
    changeNetwork(1);
    const NFTUrl = await getNFTImage(
      '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d',
      8520
    );

    expect(NFTUrl.startsWith('https://ipfs.io/ipfs/')).toBe(true);
  });
});
