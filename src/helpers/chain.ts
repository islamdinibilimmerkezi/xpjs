import axios from "axios";
import BigNumber from "bignumber.js";
import { ethers } from "ethers";
import { ChainNonce } from "../type-utils";

/**
 * NFT Info
 */
export type NftInfo<Raw> = {
  readonly uri: string;
  readonly native: Raw;
  readonly collectionIdent: string;
  readonly tokenId?: any;
  readonly originChain?: any;
};

/**
 * Action to perform before transfer/unfreeze (if any)
 */
export interface PreTransfer<Signer, Nft, Ret, ExtraArgs> {
  preTransfer(
    sender: Signer,
    nft: NftInfo<Nft>,
    fee: BigNumber,
    args?: ExtraArgs
  ): Promise<Ret | undefined>;
  preUnfreeze(
    sender: Signer,
    nft: NftInfo<Nft>,
    fee: BigNumber,
    args?: ExtraArgs
  ): Promise<Ret | undefined>;
}

/**
 * Transfer NFT to a foreign chain, freezing the original one
 *
 * @param sender  Account which owns the NFT on the native chain, able to sign transactions
 * @param chain_nonce  Nonce of the target chain
 * @param to  Address of the receiver on the foreign chain
 * @param id  Information required to freeze this nft
 *
 * @returns Transaction and the Identifier of this action to track the status
 */
export interface TransferNftForeign<Signer, RawNft, Resp> {
  transferNftToForeign(
    sender: Signer,
    chain_nonce: number,
    to: string,
    id: NftInfo<RawNft>,
    txFees: BigNumber,
    mintWith: string,
    gasLimit?: ethers.BigNumberish | undefined,
    gasPrice?: ethers.BigNumberish | undefined
  ): Promise<Resp | undefined>;
}

/**
 * Unfreeze native NFT existing on a foreign chain(Send back NFT)
 * chain_nonce is automatically derived
 *
 * @param sender  Account which owns the wrapped NFT on this chain, able to sign transactions
 * @param to  Address of the receiver on the original chain
 * @param id  Information required to unfreeze this nft
 *
 * @returns Transaction and the Identifier of this action to track the status
 */
export interface UnfreezeForeignNft<Signer, RawNft, Resp> {
  unfreezeWrappedNft(
    sender: Signer,
    to: string,
    id: NftInfo<RawNft>,
    txFees: BigNumber,
    nonce: string,
    gasLimit: ethers.BigNumberish | undefined,
    gasPrice: ethers.BigNumberish | undefined
  ): Promise<Resp>;
}

/**
 * Get the balance of an address on the chain
 */
export interface BalanceCheck {
  balance(address: string): Promise<BigNumber>;
}

/**
 * Create a new NFT on this chain
 *
 * @param options Arguments required to mint the nft
 */
export interface MintNft<Signer, Args, Identifier> {
  mintNft(owner: Signer, options: Args): Promise<Identifier>;
}

export interface ValidateAddress {
  validateAddress(adr: string): Promise<boolean>;
}

export interface EstimateTxFees<RawNftF> {
  estimateValidateTransferNft(
    to: string,
    metadata: NftInfo<RawNftF>,
    mintWith: string
  ): Promise<BigNumber>;
  estimateContractDep?(toChain: any): Promise<BigNumber>;
  isNftWhitelisted?(nft: any, signer?: any): Promise<Boolean>;
  estimateValidateUnfreezeNft(
    to: string,
    metadata: NftInfo<RawNftF>,
    mintWith: string
  ): Promise<BigNumber>;
}

export function ConcurrentSendError(): Error {
  return new Error("concurrent_send");
}

export interface PreTransferRawTxn<NativeNft, Ret> {
  preTransferRawTxn(
    id: NftInfo<NativeNft>,
    address: string,
    value?: BigNumber
  ): Promise<Ret | undefined>;
}

export interface ChainNonceGet {
  getNonce(): ChainNonce;
}

export interface ExtractAction<Txn> {
  extractAction(txn: Txn): Promise<string>;
}

export enum TransactionStatus {
  PENDING = "pending",
  SUCCESS = "success",
  FAILURE = "failure",
  UNKNOWN = "unknown",
}
export interface ExtractTxnStatus {
  extractTxnStatus(txn: string): Promise<TransactionStatus>;
}

export interface GetTokenURI {
  getTokenURI(contract: string, tokenId: string): Promise<string>;
}

export interface TransferNftForeignBatch<Signer, RawNft, Resp> {
  transferNftBatchToForeign(
    sender: Signer,
    chain_nonce: number,
    to: string,
    id: NftInfo<RawNft>[],
    mintWith: string,
    txFees: BigNumber
  ): Promise<Resp>;
}

export interface UnfreezeForeignNftBatch<Signer, RawNft, Resp> {
  unfreezeWrappedNftBatch(
    sender: Signer,
    chainNonce: number,
    to: string,
    nfts: NftInfo<RawNft>[],
    txFees: BigNumber
  ): Promise<Resp>;
}

export interface EstimateTxFeesBatch<RawNftF> {
  estimateValidateTransferNftBatch(
    to: string,
    metadatas: NftInfo<RawNftF>[],
    mintWith: string[]
  ): Promise<BigNumber>;
  estimateValidateUnfreezeNftBatch(
    to: string,
    metadatas: NftInfo<RawNftF>[]
  ): Promise<BigNumber>;
}

export type WhitelistCheck<RawNft, Singer = void> = {
  isNftWhitelisted(nft: NftInfo<RawNft>, signer?: Singer): Promise<boolean>;
};

export interface GetProvider<Provider> {
  getProvider(): Provider;
}

export async function isWrappedNft(nft: NftInfo<unknown>) {
  return (
    typeof (await axios.get(nft.uri).catch(() => undefined))?.data.wrapped !==
    "undefined"
  );
}

export interface IsContractAddress {
  isContractAddress(address: string): Promise<boolean>;
}

export interface ParamsGetter<T> {
  getParams(): T;
}

export interface FeeMargins {
  min: number;
  max: number;
}

export interface GetFeeMargins {
  getFeeMargin(): FeeMargins;
}

export interface ClaimNFT<Signer, ClaimArgs, Ret> {
  claimNFT(signer: Signer, args: ClaimArgs): Promise<Ret>;
}
