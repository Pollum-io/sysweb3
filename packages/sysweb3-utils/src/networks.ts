export enum INetworkType {
  Ethereum = 'ethereum',
  Syscoin = 'syscoin',
}

export type INetwork = {
  chainId: number;
  url: string;
  default?: boolean;
  label: string;
  key?: string | number;
  currency?: string;
};
