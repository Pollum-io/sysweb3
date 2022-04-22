import SafeEventEmitter from '@metamask/safe-event-emitter';
import * as sysweb3 from '@pollum-io/sysweb3-core';
import { setActiveNetwork } from '@pollum-io/sysweb3-network';
import {
  IKeyringAccountState,
  IWalletState,
  initialWalletState,
  INetwork,
  getSigners,
  validateSysRpc,
  SyscoinHDSigner,
  SyscoinMainSigner,
  IKeyringBalances,
} from '@pollum-io/sysweb3-utils';
import { generateMnemonic, validateMnemonic } from 'bip39';
import { fromZPrv } from 'bip84';
import CryptoJS from 'crypto-js';
import sys from 'syscoinjs-lib';
import { Web3Accounts } from './accounts';
import { SyscoinTransactions } from './transactions';
import { TrezorWallet } from './trezor';

export const KeyringManager = () => {
  /** keys */
  const web3Wallet = Web3Accounts();
  const storage = sysweb3.sysweb3Di.getStateStorageDb();

  let _password = '';

  let hd: SyscoinHDSigner = {} as SyscoinHDSigner;
  let main: SyscoinMainSigner = {} as SyscoinMainSigner;

  let wallet: IWalletState = initialWalletState;

  const hasHdMnemonic = () => {
    if (!hd.mnemonic || !main.blockbookURL) {
      const { _hd, _main } = getSigners();
      hd = _hd;
      main = _main;
    }

    return Boolean(hd.mnemonic);
  };

  storage.set('signers-key', {
    mnemonic: '',
    network: wallet.activeNetwork,
    isTestnet: false,
  });
  storage.set('keyring', {
    wallet,
    isUnlocked: Boolean(
      _password && storage.get('signers-key').mnemonic && hasHdMnemonic()
    ),
  });

  const forgetSigners = () => {
    hd = {} as SyscoinHDSigner;
    main = {} as SyscoinMainSigner;

    storage.set('signers-key', {
      mnemonic: null,
      network: null,
      isTestnet: false,
    });
    storage.set('signers', { _hd: null, _main: null });
  };
  /** end */

  /** validations */
  const checkPassword = (pwd: string) => {
    const isValid = storage.get('vault-key') === pwd;

    if (isValid) _password = pwd;

    return isValid;
  };

  const isUnlocked = () =>
    Boolean(hasHdMnemonic() && _password) || storage.get('keyring').isUnlocked;
  /** end */

  /** seeds */
  const getEncryptedMnemonic = () => {
    const encryptedMnemonic = CryptoJS.AES.encrypt(
      storage.get('signers-key').mnemonic,
      _password
    );

    return String(encryptedMnemonic);
  };

  const getDecryptedMnemonic = () => {
    const decryptedMnemonic = CryptoJS.AES.decrypt(
      getEncryptedMnemonic(),
      _password
    ).toString();

    return decryptedMnemonic;
  };

  const getSeed = (pwd: string) => (checkPassword(pwd) ? hd.mnemonic : null);
  /** end */

  /** state */
  const getState = () => wallet;
  const getNetwork = () => wallet.activeNetwork;
  const getAccounts = () => Object.values(wallet.accounts);

  const getPrivateKeyByAccountId = (id: number): string | null => {
    const account = Object.values(wallet.accounts).find(
      (account: IKeyringAccountState) => account.id === id
    );

    return account ? account.xprv : null;
  };

  const getAccountXpub = (): string => hd.getAccountXpub();

  const getAccountById = (id: number): IKeyringAccountState =>
    Object.values(wallet.accounts).find((account) => account.id === id) ||
    ({} as IKeyringAccountState);

  /** end */

  /** controllers */
  const trezor = TrezorWallet();
  const txs = SyscoinTransactions();
  /** end */

  /** private */
  const _clearWallet = () => {
    wallet = initialWalletState;

    _updateLocalStoreWallet();
  };

  const _clearTemporaryLocalKeys = () => {
    storage.set('signers-key', {
      ...storage.get('signers-key'),
      mnemonic: '',
      network: wallet.activeNetwork,
    });

    _password = '';
  };

  const _persistWallet = (password: string = _password): string | Error => {
    if (typeof password !== 'string') {
      return new Error('KeyringManager - password is not a string');
    }

    _password = password;

    const serializedWallet = JSON.stringify(wallet);

    /** set vault in storage so we can get back the state when logging in */
    storage.set('vault', serializedWallet);

    return serializedWallet;
  };

  const _updateLocalStoreWallet = () => {
    return storage.set('keyring', { ...storage.get('keyring'), wallet });
  };

  const _notifyUpdate = () => {
    const eventEmitter = new SafeEventEmitter();

    eventEmitter.emit('update', storage.get('keyring'));
  };

  const _fullUpdate = () => {
    _persistWallet(_password);
    _updateLocalStoreWallet();
    _notifyUpdate();
  };

  const _updateUnlocked = () => {
    const eventEmitter = new SafeEventEmitter();

    storage.set('keyring', { ...storage.get('keyring'), isUnlocked: true });
    eventEmitter.emit('unlock');
  };

  const _unlockWallet = async (password: string): Promise<IWalletState> => {
    const { wallet: _wallet } = storage.get('keyring');

    if (!_wallet) {
      _password = password;

      throw new Error('Wallet not found');
    }

    _clearWallet();

    wallet = _wallet;
    _password = password;

    _updateLocalStoreWallet();

    return _wallet;
  };

  const _createMainWallet = async (): Promise<IKeyringAccountState> => {
    const { _hd, _main } = getSigners();

    const hdsigner = Object.assign(_hd, Object.getPrototypeOf(_hd));
    const mainsigner = Object.assign(_main, Object.getPrototypeOf(_main));

    hd = hdsigner;
    main = mainsigner;

    storage.set('signers', { _hd: hdsigner, _main: mainsigner });

    const xprv = getEncryptedXprv();

    const createdAccount = await _getLatestUpdateForSysAccount();

    const account: IKeyringAccountState = _getInitialAccountData({
      signer: _hd,
      createdAccount,
      xprv,
    });

    hd && hd.setAccountIndex(account.id);

    return account;
  };

  const _getEncryptedPrivateKeyFromHd = () =>
    hd.Signer.accounts[hd.Signer.accountIndex].getAccountPrivateKey();

  const _getLatestUpdateForWeb3Accounts = async () => {
    const { mnemonic, network } = storage.get('signers-key');

    const { address, privateKey } = web3Wallet.importAccount(mnemonic);
    const balance = await web3Wallet.getBalance(address);

    const { id } = wallet.activeAccount;

    const transactions = await web3Wallet.getUserTransactions(
      address,
      network.chainId === 1
        ? 'homestead'
        : network.chainId === 4
        ? 'rinkeby'
        : network.chainId === 42
        ? 'kovan'
        : network.chainId === 3
        ? 'ropsten'
        : network.chainId === 5
        ? 'goerli'
        : 'homestead'
    );

    return {
      assets: [],
      id,
      isTrezorWallet: false,
      label: `Account ${id}`,
      transactions,
      trezorId: -1,
      xprv: privateKey,
      balances: {
        ethereum: balance,
        syscoin: 0,
      },
      xpub: address,
      address: address,
    };
  };

  const _getInitialAccountData = ({
    label,
    signer,
    createdAccount,
    xprv,
  }: {
    label?: string;
    signer: any;
    createdAccount: any;
    xprv: string;
  }) => {
    console.log('[get initial account data] getting initial account...');
    const { balances, receivingAddress, xpub, transactions, assets } =
      createdAccount;

    const account = {
      id: signer.Signer.accountIndex,
      label: label ? label : `Account ${signer.Signer.accountIndex + 1}`,
      balances,
      xpub,
      xprv,
      address: receivingAddress,
      isTrezorWallet: false,
      transactions,
      assets,
    };

    return account;
  };

  const _getAccountForNetwork = async ({
    isSyscoinChain,
  }: {
    isSyscoinChain: boolean;
  }) => {
    const { mnemonic, network } = storage.get('signers-key');

    wallet = {
      ...wallet,
      activeNetwork: network,
    };

    _fullUpdate();

    if (isSyscoinChain) {
      const { _hd, _main } = getSigners();

      const hdsigner = Object.assign(_hd, Object.getPrototypeOf(_hd));
      const mainsigner = Object.assign(_main, Object.getPrototypeOf(_main));

      hd = hdsigner;
      main = mainsigner;

      storage.set('signers', { _hd: hdsigner, _main: mainsigner });

      const xprv = getEncryptedXprv();

      const { isTestnet } = await validateSysRpc(network.url);

      storage.set('signers-key', { mnemonic, network, isTestnet });

      const updatedAccountInfo = await _getLatestUpdateForSysAccount();

      const account = _getInitialAccountData({
        signer: _hd,
        createdAccount: updatedAccountInfo,
        xprv,
      });

      hd && hd.setAccountIndex(account.id);

      return account;
    }

    return await _getLatestUpdateForWeb3Accounts();
  };

  const _getFormattedBackendAccount = async ({
    url,
    xpub,
  }: {
    url: string;
    xpub: string;
  }) => {
    const options = 'tokens=nonzero&details=txs';

    const { address, balance, transactions, tokensAsset } =
      await sys.utils.fetchBackendAccount(url, xpub, options, xpub);

    const latestAssets = tokensAsset ? tokensAsset.slice(0, 30) : [];
    const assets = latestAssets.map((token: any) => ({
      ...token,
      symbol: atob(token.symbol),
    }));

    return {
      transactions: transactions ? transactions.slice(0, 20) : [],
      assets,
      xpub: address,
      balances: {
        syscoin: balance / 1e8,
        ethereum: 0,
      },
    };
  };

  const _getLatestUpdateForSysAccount = async (): Promise<{
    xpub: string;
    balances: IKeyringBalances;
    transactions: any;
    assets: any;
    address: string;
  }> => {
    const { _hd, _main } = getSigners();

    hd = _hd;
    main = _main;

    const xpub = hd.getAccountXpub();
    const formattedBackendAccount = await _getFormattedBackendAccount({
      url: main.blockbookURL || wallet.activeNetwork.url,
      xpub,
    });
    const receivingAddress = await hd.getNewReceivingAddress(true);

    return {
      address: receivingAddress,
      ...formattedBackendAccount,
    };
  };
  /** end */

  /** keyring */
  const setWalletPassword = (pwd: string) => {
    _password = pwd;

    storage.set('vault-key', pwd);
  };

  const createSeed = () => {
    const signers = storage.get('signers-key');

    if (!signers.mnemonic)
      storage.set('signers-key', { ...signers, mnemonic: generateMnemonic() });

    return storage.get('signers-key').mnemonic;
  };

  const createKeyringVault = async (): Promise<IKeyringAccountState> => {
    _clearWallet();

    const vault = await _createMainWallet();

    wallet = {
      ...wallet,
      accounts: {
        ...wallet.accounts,
        [vault.id]: vault,
      },
      activeAccount: vault,
    };

    storage.set('keyring', { ...storage.get('keyring'), isUnlocked: true });

    _fullUpdate();

    return vault;
  };

  /** login/logout */
  const login = async (
    password: string
  ): Promise<IKeyringAccountState | Error> => {
    if (!checkPassword(password)) return new Error('Invalid password');

    wallet = await _unlockWallet(password);

    setAccountIndexForDerivedAccount(wallet.activeAccount.id);
    _updateUnlocked();
    _notifyUpdate();
    _updateLocalStoreWallet();
    await getLatestUpdateForAccount();

    return wallet.activeAccount;
  };

  const logout = () => {
    const eventEmitter = new SafeEventEmitter();

    _clearTemporaryLocalKeys();

    storage.set('keyring', { ...storage.get('keyring'), isUnlocked: false });

    hd = {} as SyscoinHDSigner;
    main = {} as SyscoinMainSigner;

    eventEmitter.emit('lock');

    _notifyUpdate();
  };
  /** end */

  const removeAccount = (accountId: number) => {
    delete wallet.accounts[accountId];
  };

  const signMessage = (
    msgParams: { accountId: number; data: string },
    opts?: any
  ): void => {
    const account = getAccountById(msgParams.accountId);

    txs.signMessage(account, msgParams.data, opts);
  };

  const forgetMainWallet = (pwd: string) => {
    if (checkPassword(pwd)) return new Error('Invalid password');

    _clearTemporaryLocalKeys();

    forgetSigners();

    wallet = initialWalletState;

    _fullUpdate();
  };

  const getEncryptedXprv = () =>
    CryptoJS.AES.encrypt(_getEncryptedPrivateKeyFromHd(), _password).toString();

  const validateSeed = (seedphrase: string) => {
    if (validateMnemonic(seedphrase)) {
      storage.set('signers-key', {
        ...storage.get('signers-key'),
        mnemonic: seedphrase,
      });

      return true;
    }

    return false;
  };

  /** get updates */
  const getLatestUpdateForAccount = async () => {
    const { wallet: _wallet } = storage.get('keyring');

    wallet = _wallet;

    _updateLocalStoreWallet();

    const isSyscoinChain = Boolean(
      wallet.networks.syscoin[wallet.activeNetwork.chainId]
    );

    const latestUpdate = isSyscoinChain
      ? await _getLatestUpdateForSysAccount()
      : await _getLatestUpdateForWeb3Accounts();

    return latestUpdate;
  };
  /** end */

  /** networks */
  const _setSignerByChain = async (network: INetwork, chain: string) => {
    storage.set('signers-key', {
      mnemonic: storage.get('signers-key').mnemonic,
      network,
    });

    if (chain === 'syscoin') {
      const { isTestnet } = await validateSysRpc(network.url);

      storage.set('signers-key', { ...storage.get('signers-key'), isTestnet });

      return;
    }

    setActiveNetwork('ethereum', network.chainId, wallet.networks);

    storage.set('signers-key', {
      ...storage.get('signers-key'),
      isTestnet: false,
    });
  };

  /** networks */
  const setSignerNetwork = async (
    network: INetwork,
    chain: string
  ): Promise<IKeyringAccountState> => {
    await _setSignerByChain(network, chain);

    wallet = {
      ...wallet,
      networks: {
        ...wallet.networks,
        [chain]: {
          [network.chainId]: network,
        },
      },
      activeNetwork: network,
    };

    _fullUpdate();

    await _setSignerByChain(network, chain);

    const account = await _getAccountForNetwork({
      isSyscoinChain: chain === 'syscoin',
    });

    wallet = {
      ...wallet,
      accounts: {
        ...wallet.accounts,
        [account.id]: account,
      },
      activeAccount: account,
    };

    _fullUpdate();

    return account;
  };
  /** end */

  /** accounts */
  const setAccountIndexForDerivedAccount = (accountId: number) => {
    const childAccount = hd.deriveAccount(accountId);

    const derivedAccount = new fromZPrv(
      childAccount,
      hd.Signer.pubTypes,
      hd.Signer.networks
    );

    hd.Signer.accounts.push(derivedAccount);
    hd.setAccountIndex(accountId);
  };
  /** end */

  const addNewAccount = async (label: string) => {
    const { network } = storage.get('signers-key');

    const isSyscoinChain = Boolean(wallet.networks.syscoin[network.chainId]);

    const { _hd } = getSigners();

    if (isSyscoinChain) {
      const id = _hd.createAccount();

      _hd.setAccountIndex(id);

      const latestUpdate = await getLatestUpdateForAccount();
      const xprv = getEncryptedXprv();

      const account = _getInitialAccountData({
        label,
        signer: _hd,
        createdAccount: latestUpdate,
        xprv,
      });

      return {
        ...account,
        id,
      };
    }

    const { address, privateKey } = web3Wallet.createAccount();

    const balance = web3Wallet.getBalance(address);

    const createdAccount = {
      balances: {
        syscoin: 0,
        ethereum: balance,
      },
      receivingAddress: address,
      xpub: address,
    };

    const initialAccount = _getInitialAccountData({
      label,
      signer: _hd,
      createdAccount,
      xprv: privateKey,
    });

    wallet = {
      ...wallet,
      accounts: {
        ...wallet.accounts,
        [initialAccount.id]: initialAccount,
      },
      activeAccount: initialAccount,
    };

    return initialAccount;
  };

  const removeNetwork = (chain: string, chainId: number) => {
    // @ts-ignore
    delete wallet.networks[chain][chainId];
  };

  return {
    validateSeed,
    setWalletPassword,
    createSeed,
    createKeyringVault,
    getAccountById,
    checkPassword,
    isUnlocked,
    getEncryptedMnemonic,
    getDecryptedMnemonic,
    getState,
    getNetwork,
    getPrivateKeyByAccountId,
    logout,
    login,
    getAccounts,
    removeAccount,
    signMessage,
    forgetMainWallet,
    getEncryptedXprv,
    txs,
    trezor,
    getAccountXpub,
    getLatestUpdateForAccount,
    setSignerNetwork,
    getSeed,
    hasHdMnemonic,
    forgetSigners,
    setAccountIndexForDerivedAccount,
    addNewAccount,
    removeNetwork,
  };
};
