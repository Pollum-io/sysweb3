import { ObservableStore } from '@metamask/obs-store';
import { MainWallet } from './wallets/main';
import { encryptor } from '@syspollum/sysweb3-utils';
import SafeEventEmitter from '@metamask/safe-event-emitter';
import { IKeyringAccountState, IWalletState } from '@syspollum/sysweb3-types';
import * as sysweb3 from '@syspollum/sysweb3-core';
import CryptoJS from 'crypto-js';
import { generateMnemonic } from 'bip39';
import { initialWalletState } from './initialState';

export const KeyringManager = () => {
  const eventEmitter = new SafeEventEmitter();
  const storage = sysweb3.sysweb3Di.getStateStorageDb();

  const { createWallet } = MainWallet();

  let _password = '';
  let _mnemonic = '';

  let wallet: IWalletState = initialWalletState;

  const generatePhrase = () => {
    if (!_mnemonic) _mnemonic = generateMnemonic();

    return _mnemonic;
  };

  const getEncryptedMnemonic = (
    mnemonic: string,
    encryptedPassword: string
  ) => {
    const encryptedMnemonic = CryptoJS.AES.encrypt(mnemonic, encryptedPassword);

    return encryptedMnemonic;
  };

  const getAccountById = (id: number): IKeyringAccountState | null =>
    Object.values(wallet.accounts).find(
      (account: IKeyringAccountState) => account.id === id
    ) || null;

  const getPrivateKeyByAccountId = (id: number) => {
    const account = Object.values(wallet.accounts).find(
      (account: IKeyringAccountState) => account.id === id
    );

    return account ? account.xprv : null;
  };

  const getState = () => wallet;
  const getNetwork = () => wallet.activeNetwork;
  const getAccounts = () => Object.values(wallet.accounts);

  const _memStore = new ObservableStore<{
    isUnlocked: boolean;
    wallet: IWalletState;
  }>({
    isUnlocked: false,
    wallet: initialWalletState,
  });

  const _clearWallet = () => {
    wallet = initialWalletState;

    _memStore.updateState({
      wallet: initialWalletState,
    });
  };

  const _persistWallet = async (password: string = _password) => {
    if (typeof password !== 'string') {
      return new Error('KeyringManager - password is not a string');
    }

    _password = password;

    const serializedWallet = JSON.stringify(wallet);

    const encryptedWallet = encryptor.encrypt(serializedWallet, _password);

    storage.set('vault', encryptedWallet);

    return encryptedWallet;
  };

  const _updateMemStoreWallet = () => {
    const walletState = wallet.getState();

    return _memStore.updateState({ wallet: walletState });
  };

  const _notifyUpdate = () => {
    eventEmitter.emit('update', _memStore.getState());
  };

  const _fullUpdate = async () => {
    await _persistWallet(_password);
    _updateMemStoreWallet();
    _notifyUpdate();
  };

  const createVault = async ({
    encryptedPassword,
    networkId,
  }): Promise<IKeyringAccountState> => {
    _clearWallet();

    const wallet: IKeyringAccountState = await createWallet({
      encryptedPassword,
      networkId,
      mnemonic: _mnemonic,
    });

    console.log('[keyring] creating wallet:', wallet);

    await _fullUpdate();

    return wallet;
  };

  const setWalletPassword = (pwd: string) => {
    _password = pwd;
  };

  const addTokenToAccount = (accountId: number, address: string) => {
    const account: IKeyringAccountState | null = getAccountById(accountId);

    account?.saveTokenInfo(address);

    _fullUpdate();

    return account;
  };

  const logout = () => {
    _password = '';
    _memStore.updateState({ isUnlocked: false });
    eventEmitter.emit('lock');
    _notifyUpdate();
  };

  const _updateUnlocked = () => {
    _memStore.updateState({ isUnlocked: true });
    eventEmitter.emit('unlock');
  };

  const login = async (password: string) => {
    wallet = await _unlockWallet(password);

    _updateUnlocked();
    _notifyUpdate();
  };

  const _unlockWallet = async (password: string): Promise<IWalletState> => {
    const encryptedVault = storage.get('vault');

    if (!encryptedVault) {
      _password = password;

      return {} as IWalletState;
    }

    _clearWallet();

    const decryptedWallet: string = encryptor.decrypt(password, encryptedVault);

    wallet = JSON.parse(decryptedWallet);

    _password = password;

    _updateMemStoreWallet();

    return wallet;
  };

  const removeAccount = () => {};

  const signTransaction = (tx, accountId: number, options = {}) => {
    const account = getAccountById(accountId);

    account?.signTransaction(account, tx, options);
  };

  const signMessage = (
    msgParams: { accountId: number; data: string },
    opts?: any
  ) => {
    const account = getAccountById(msgParams.accountId);

    return account?.signMessage(account, msgParams.data, opts);
  };

  return {
    createVault,
    setWalletPassword,
    address: null,
    addTokenToAccount,
    getState,
    getNetwork,
    getAccountById,
    getPrivateKeyByAccountId,
    logout,
    login,
    getAccounts,
    removeAccount,
    signMessage,
    signTransaction,
    generatePhrase,
    getEncryptedMnemonic,
  };
};