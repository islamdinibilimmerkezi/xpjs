/**
 * Web3 Implementation for cross chain traits
 * @module
 */
import BigNumber from "bignumber.js";
import {
  BalanceCheck,
  EstimateTxFeesBatch,
  FeeMargins,
  GetFeeMargins,
  GetProvider,
  IsContractAddress,
  MintNft,
  TransferNftForeign,
  TransferNftForeignBatch,
  UnfreezeForeignNft,
  UnfreezeForeignNftBatch,
  ParamsGetter,
} from "./chain";
import {
  BigNumber as EthBN,
  ContractTransaction,
  ethers,
  PopulatedTransaction,
  providers,
  Signer,
  VoidSigner,
  Wallet,
} from "ethers";
import { Provider, TransactionResponse } from "@ethersproject/providers";
import {
  Erc1155Minter,
  Erc1155Minter__factory,
  Minter__factory,
  UserNftMinter,
  UserNftMinter__factory,
} from "xpnet-web3-contracts";
import {
  ChainNonceGet,
  EstimateTxFees,
  ExtractAction,
  ExtractTxnStatus,
  GetTokenURI,
  NftInfo,
  PreTransfer,
  PreTransferRawTxn,
  TransactionStatus,
  ValidateAddress,
  WhitelistCheck,
} from "..";
import { ChainNonce } from "../type-utils";
import { EvNotifier } from "../notifier";
import axios from "axios";
import { hethers } from "@hashgraph/hethers";
/**
 * Information required to perform NFT transfers in this chain
 */
export type EthNftInfo = {
  chainId: string;
  tokenId: string;
  owner: string;
  uri: string;
  contract: string;
  contractType: "ERC721" | "ERC1155";
};

/**
 * Arguments required for minting a new nft
 *
 * contract: address of the sc
 * token: token ID of the newly minted nft
 * owner: Owner of the newly minted nft
 * uri: uri of the nft
 */
export type MintArgs = {
  contract: string;
  uri: string;
};

export interface IsApproved<Sender> {
  isApprovedForMinter(
    address: NftInfo<EthNftInfo>,
    sender: Sender,
    txFee: BigNumber,
    gasPrice?: ethers.BigNumber
  ): Promise<boolean>;
}

export interface Approve<Sender> {
  approveForMinter(
    address: NftInfo<EthNftInfo>,
    sender: Sender,
    txFee: BigNumber,
    gasPrice?: ethers.BigNumber
  ): Promise<string | undefined>;
}

hethers.providers.BaseProvider.prototype.getGasPrice = async () => {
  return EthBN.from("1");
};

type NullableCustomData = Record<string, any> | undefined;

/**
 * Base util traits
 */
export type BaseWeb3Helper = BalanceCheck &
  /**
   * Mint an nft in the given ERC1155 smart contract
   *
   * @argument signer  owner of the smart contract
   * @argument args  See [[MintArgs]]
   */ MintNft<Signer, MintArgs, ContractTransaction> & {
    /**
     * Deploy an ERC721 smart contract
     *
     * @argument owner  Owner of this smart contract
     * @returns Address of the deployed smart contract
     */
    deployErc721(owner: Signer): Promise<string>;
  } & {
    mintNftErc1155(
      owner: Signer,
      options: MintArgs
    ): Promise<ContractTransaction>;
  };

type ExtraArgs = { gasPrice: ethers.BigNumber };

/**
 * Traits implemented by this module
 */
export type Web3Helper = BaseWeb3Helper &
  TransferNftForeign<Signer, EthNftInfo, TransactionResponse> &
  UnfreezeForeignNft<Signer, EthNftInfo, TransactionResponse> &
  TransferNftForeignBatch<Signer, EthNftInfo, TransactionResponse> &
  UnfreezeForeignNftBatch<Signer, EthNftInfo, TransactionResponse> &
  EstimateTxFees<EthNftInfo> &
  EstimateTxFeesBatch<EthNftInfo> &
  ChainNonceGet &
  IsApproved<Signer> &
  Approve<Signer> &
  ValidateAddress &
  ExtractAction<TransactionResponse> & {
    createWallet(privateKey: string): Wallet;
  } & Pick<PreTransfer<Signer, EthNftInfo, string, ExtraArgs>, "preTransfer"> &
  PreTransferRawTxn<EthNftInfo, PopulatedTransaction> &
  ExtractTxnStatus &
  GetProvider<providers.Provider> & {
    XpNft: string;
    XpNft1155: string;
  } & WhitelistCheck<EthNftInfo> &
  GetFeeMargins &
  IsContractAddress &
  GetTokenURI &
  ParamsGetter<Web3Params>;

/**
 * Create an object implementing minimal utilities for a web3 chain
 *
 * @param provider An ethers.js provider object
 */
export async function baseWeb3HelperFactory(
  provider: Provider,
  nonce: number
): Promise<BaseWeb3Helper> {
  const w3 = provider;

  return {
    async balance(address: string): Promise<BigNumber> {
      const bal = await w3.getBalance(address);

      // ethers BigNumber is not compatible with our bignumber
      return new BigNumber(bal.toString());
    },
    async deployErc721(owner: Signer): Promise<string> {
      const factory = new UserNftMinter__factory(owner);
      const contract = await factory.deploy();

      return contract.address;
    },
    async mintNftErc1155(owner: Signer, { contract }) {
      const erc1155 = Erc1155Minter__factory.connect(contract!, owner);
      const tx = await erc1155.mintNft(await owner.getAddress());

      return tx;
    },
    async mintNft(
      owner: Signer,
      { contract, uri }: MintArgs
    ): Promise<ContractTransaction> {
      const erc721 = UserNftMinter__factory.connect(contract!, owner);
      const txm = await erc721
        .mint(uri, { gasLimit: 1000000 })
        .catch(async (e) => {
          if (nonce === 33) {
            let tx;
            while (!tx) {
              tx = await provider.getTransaction(e["returnedHash"]);
            }
            return tx;
          }
          throw e;
        });
      return txm;
    },
  };
}

/**
 * Create an object implementing cross chain utilities for a web3 chain
 *
 * @param provider  An ethers.js provider object
 * @param minter_addr  Address of the minter smart contract
 * @param minter_abi  ABI of the minter smart contract
 */
export interface Web3Params {
  provider: Provider;
  notifier: EvNotifier;
  minter_addr: string;
  erc721_addr: string;
  erc1155_addr: string;
  erc721Minter: string;
  erc1155Minter: string;
  nonce: ChainNonce;
  feeMargin: FeeMargins;
}

type NftMethodVal<T, Tx> = {
  freeze: "freezeErc1155" | "freezeErc721";
  validateUnfreeze: "validateUnfreezeErc1155" | "validateUnfreezeErc721";
  umt: typeof Erc1155Minter__factory | typeof UserNftMinter__factory;
  approved: (
    umt: T,
    sender: string,
    minterAddr: string,
    tok: string,
    customData: NullableCustomData
  ) => Promise<boolean>;
  approve: (
    umt: T,
    forAddr: string,
    tok: string,
    txnUp: (tx: PopulatedTransaction) => Promise<void>,
    customData: NullableCustomData,
    gasPrice: ethers.BigNumberish | undefined
  ) => Promise<Tx>;
};

type EthNftMethodVal<T> = NftMethodVal<T, ContractTransaction>;

type NftMethodMap = Record<
  "ERC1155" | "ERC721",
  EthNftMethodVal<Erc1155Minter> | EthNftMethodVal<UserNftMinter>
>;

export const NFT_METHOD_MAP: NftMethodMap = {
  ERC1155: {
    freeze: "freezeErc1155",
    validateUnfreeze: "validateUnfreezeErc1155",
    umt: Erc1155Minter__factory,
    approved: (
      umt: Erc1155Minter,
      sender: string,
      minterAddr: string,
      _tok: string,
      customData: NullableCustomData
    ) => {
      return umt.isApprovedForAll(sender, minterAddr, {
        gasLimit: "85000",
        customData,
      });
    },
    approve: async (
      umt: Erc1155Minter,
      forAddr: string,
      _tok: string,
      txnUp: (tx: PopulatedTransaction) => Promise<void>,
      customData: NullableCustomData
    ) => {
      const tx = await umt.populateTransaction.setApprovalForAll(
        forAddr,
        true,
        {
          gasLimit: "85000",
          customData,
        }
      );
      await txnUp(tx);
      return await umt.signer.sendTransaction(tx);
    },
  },
  ERC721: {
    freeze: "freezeErc721",
    validateUnfreeze: "validateUnfreezeErc721",
    umt: UserNftMinter__factory,
    approved: async (
      umt: UserNftMinter,
      _: string,
      minterAddr: string,
      tok: string,
      customData: NullableCustomData
    ) => {
      return (
        (
          await umt.getApproved(tok, {
            gasLimit: "85000",
            customData,
            //@ts-ignore
          })
        ).toLowerCase() == minterAddr.toLowerCase()
      );
    },
    approve: async (
      umt: UserNftMinter,
      forAddr: string,
      tok: string,
      txnUp: (tx: PopulatedTransaction) => Promise<void>
    ) => {
      const tx = await umt.populateTransaction.approve(forAddr, tok, {
        gasLimit: "85000",
      });
      await txnUp(tx);
      return await umt.signer.sendTransaction(tx);
    },
  },
};

export async function web3HelperFactory(
  params: Web3Params
): Promise<Web3Helper> {
  const txnUnderpricedPolyWorkaround =
    params.nonce == 7
      ? async (utx: PopulatedTransaction) => {
          const res = await axios
            .get(
              "https://gpoly.blockscan.com/gasapi.ashx?apikey=key&method=pendingpooltxgweidata"
            )
            .catch(async () => {
              return await axios.get(
                "https://gasstation-mainnet.matic.network/v2"
              );
            });
          const { result, fast } = res.data;
          const trackerGas = result?.rapidgaspricegwei || fast?.maxFee;

          if (trackerGas) {
            const sixtyGwei = ethers.utils.parseUnits(
              Math.ceil(trackerGas).toString(),
              "gwei"
            );
            utx.maxFeePerGas = sixtyGwei;
            utx.maxPriorityFeePerGas = sixtyGwei;
          }
        }
      : () => Promise.resolve();

  const w3 = params.provider;
  const { minter_addr, provider } = params;
  const minter = Minter__factory.connect(minter_addr, provider);

  async function notifyValidator(
    fromHash: string,
    actionId?: string,
    type?: string,
    toChain?: number,
    txFees?: string,
    senderAddress?: string,
    targetAddress?: string,
    nftUri?: string,
    tokenId?: string,
    contract?: string
  ): Promise<void> {
    await params.notifier.notifyWeb3(
      params.nonce,
      fromHash,
      actionId,
      type,
      toChain,
      txFees,
      senderAddress,
      targetAddress,
      nftUri,
      tokenId,
      contract
    );
  }

  //@ts-ignore
  async function getTransaction(hash: string) {
    let trx;
    let fails = 0;
    while (!trx && fails < 7) {
      trx = await provider.getTransaction(hash);
      await new Promise((resolve) =>
        setTimeout(() => resolve("wait"), 5000 + fails * 2)
      );
      fails++;
    }

    return trx as TransactionResponse;
  }

  async function extractAction(txr: TransactionResponse): Promise<string> {
    const receipt = await txr.wait();
    const log = receipt.logs.find((log) => log.address === minter.address);
    if (log === undefined) {
      throw Error("Couldn't extract action_id");
    }

    const evdat = minter.interface.parseLog(log);
    const action_id: string = evdat.args[0].toString();
    return action_id;
  }

  const isApprovedForMinter = async (
    id: NftInfo<EthNftInfo>,
    signer: Signer
  ) => {
    const erc = NFT_METHOD_MAP[id.native.contractType].umt.connect(
      id.native.contract,
      signer
    );
    const toApprove =
      params.nonce !== 0x1d
        ? minter_addr
        : id.native.uri.includes("herokuapp.com")
        ? params.minter_addr
        : params.erc721_addr;
    return await NFT_METHOD_MAP[id.native.contractType].approved(
      erc as any,
      await signer.getAddress(),
      toApprove,
      id.native.tokenId,
      params.nonce === 0x1d ? {} : undefined
    );
  };

  const approveForMinter = async (
    id: NftInfo<EthNftInfo>,
    sender: Signer,
    _txFees: BigNumber,
    gasPrice: ethers.BigNumberish | undefined
  ) => {
    const isApproved = await isApprovedForMinter(id, sender);
    if (isApproved) {
      return undefined;
    }
    const erc = NFT_METHOD_MAP[id.native.contractType].umt.connect(
      id.native.contract,
      sender
    );

    const toApprove =
      params.nonce !== 0x1d
        ? minter_addr
        : id.native.uri.includes("herokuapp.com")
        ? params.minter_addr
        : params.erc721_addr;

    const receipt = await NFT_METHOD_MAP[id.native.contractType].approve(
      erc as any,
      toApprove,
      id.native.tokenId,
      txnUnderpricedPolyWorkaround,
      params.nonce === 0x1d ? {} : undefined,
      gasPrice
    );
    await receipt.wait();
    return receipt.hash;
  };

  const base = await baseWeb3HelperFactory(params.provider, params.nonce);

  return {
    ...base,
    XpNft: params.erc721_addr,
    XpNft1155: params.erc1155_addr,
    getParams: () => params,
    approveForMinter,
    getProvider: () => provider,
    async estimateValidateUnfreezeNft(_to, _id, _mW) {
      const gas = await provider.getGasPrice();
      return new BigNumber(gas.mul(150_000).toString());
    },
    getFeeMargin() {
      return params.feeMargin;
    },
    isApprovedForMinter,
    preTransfer: (s, id, fee, args) =>
      approveForMinter(id, s, fee, args?.gasPrice),
    extractAction,
    async isContractAddress(address) {
      const code = await provider.getCode(address);
      return code !== "0x";
    },
    getNonce: () => params.nonce,
    async preTransferRawTxn(id, address, _value) {
      const isApproved = await isApprovedForMinter(
        id,
        new VoidSigner(address, provider)
      );

      if (isApproved) {
        return undefined;
      }

      const erc = UserNftMinter__factory.connect(
        id.native.contract,
        new VoidSigner(address, provider)
      );

      const approvetxn = await erc.populateTransaction.approve(
        minter_addr,
        id.native.tokenId
      );

      return approvetxn;
    },

    async extractTxnStatus(txn) {
      const status = (await (await provider.getTransaction(txn)).wait()).status;
      if (status === undefined) {
        return TransactionStatus.PENDING;
      }
      if (status === 1) {
        return TransactionStatus.SUCCESS;
      } else if (status === 0) {
        return TransactionStatus.FAILURE;
      }
      return TransactionStatus.UNKNOWN;
    },
    async getTokenURI(contract, tokenId) {
      if (ethers.utils.isAddress(contract) && tokenId) {
        const erc721 = UserNftMinter__factory.connect(contract!, provider);
        //const erc1155 = Erc1155Minter__factory.connect(contract!, provider)
        //erc1155.uri()
        return await erc721.tokenURI(tokenId).catch(() => "");
      }
      return "";
    },
    async unfreezeWrappedNftBatch(signer, chainNonce, to, nfts, txFees) {
      const tx = await minter
        .connect(signer)
        .populateTransaction.withdrawNftBatch(
          to,
          chainNonce,
          nfts.map((nft) => nft.native.tokenId),
          new Array(nfts.length).fill(1),
          nfts[0].native.contract,
          {
            value: EthBN.from(txFees.toFixed(0)),
          }
        );
      await txnUnderpricedPolyWorkaround(tx);
      const res = await signer.sendTransaction(tx);

      // await notifyValidator(
      //   res.hash,
      //   await extractAction(res),
      //   "Unfreeze",
      //   chainNonce.toString(),
      //   txFees.toString(),
      //   await signer.getAddress(),
      //   to,
      //   res.data
      // );
      await notifyValidator(res.hash);

      return res;
    },
    async transferNftBatchToForeign(
      signer,
      chainNonce,
      to,
      nfts,
      mintWith,
      txFees
    ) {
      const tx = await minter
        .connect(signer)
        .populateTransaction.freezeErc1155Batch(
          nfts[0].native.contract,
          nfts.map((nft) => nft.native.tokenId),
          new Array(nfts.length).fill(1),
          chainNonce,
          to,
          mintWith,
          {
            value: EthBN.from(txFees.toFixed(0)),
          }
        );
      await txnUnderpricedPolyWorkaround(tx);

      const res = await signer.sendTransaction(tx);

      await notifyValidator(res.hash);

      return res;
    },
    async estimateValidateTransferNftBatch(_to, nfts, _mintWith) {
      const gasPrice = await w3.getGasPrice();
      const gas = 40_000 + 60_000 * nfts.length;
      return new BigNumber(gasPrice.mul(gas).toString());
    },
    async estimateValidateUnfreezeNftBatch(_to, nfts) {
      const gasPrice = await w3.getGasPrice();
      const gas = 40_000 + 60_000 * nfts.length;
      return new BigNumber(gasPrice.mul(gas).toString());
    },
    createWallet(privateKey: string): Wallet {
      return new Wallet(privateKey, provider);
    },
    async transferNftToForeign(
      sender: Signer,
      chain_nonce: number,
      to: string,
      id: NftInfo<EthNftInfo>,
      txFees: BigNumber,
      mintWith: string,
      gasLimit: ethers.BigNumberish | undefined = undefined,
      gasPrice
    ): Promise<TransactionResponse> {
      await approveForMinter(id, sender, txFees, gasPrice);
      const method = NFT_METHOD_MAP[id.native.contractType].freeze;

      // Chain is Hedera
      if (params.nonce === 0x1d) {
        id.native.tokenId = ethers.utils.solidityPack(
          ["uint160", "int96"],
          [id.collectionIdent, id.native.tokenId]
        );
        id.native.contract = params.erc721_addr;
      }

      const tx = await minter
        .connect(sender)
        .populateTransaction[method](
          id.native.contract,
          id.native.tokenId,
          chain_nonce,
          to,
          mintWith,
          {
            value: EthBN.from(txFees.toFixed(0)),
            gasLimit,
            gasPrice,
          }
        );
      await txnUnderpricedPolyWorkaround(tx);

      const txr: TransactionResponse | unknown = await sender
        .sendTransaction(tx)
        .catch((e) => {
          if (params.nonce === 33) {
            return e;
          } else throw e;
        });
      let txHash: string;
      if (params.nonce === 0x1d) {
        //@ts-ignore checked hedera
        txHash = txr["transactionId"];
      } else if (params.nonce === 33) {
        //@ts-ignore checked abeychain
        txHash = txr["returnedHash"] || txr.hash;
      } else {
        //@ts-ignore checked normal evm
        txHash = txr.hash;
      }

      await notifyValidator(
        //@ts-ignore
        txHash
      );
      if (params.nonce === 33) {
        return await provider.getTransaction(txHash);
      }
      return txr as any;
    },
    async unfreezeWrappedNft(
      sender: Signer,
      to: string,
      id: NftInfo<EthNftInfo>,
      txFees: BigNumber,
      nonce,
      gasLimit = undefined,
      gasPrice
    ): Promise<TransactionResponse> {
      await approveForMinter(id, sender, txFees, gasPrice);

      // Chain is Hedera
      if (params.nonce === 0x1d) {
        id.native.tokenId = ethers.utils.solidityPack(
          ["uint160", "int96"],
          [EthBN.from(id.collectionIdent), id.native.tokenId]
        );
        id.native.contract = params.erc721_addr;
      }

      const txn = await minter
        .connect(sender)
        .populateTransaction.withdrawNft(
          to,
          nonce,
          id.native.tokenId,
          id.native.contract,
          {
            value: EthBN.from(txFees.toFixed(0)),
            gasLimit,
            gasPrice,
          }
        );

      await txnUnderpricedPolyWorkaround(txn);
      const res = await sender.sendTransaction(txn);
      console.log(res, "res");
      let txHash: string;
      if (params.nonce === 0x1d) {
        //@ts-ignore checked hedera
        txHash = res["transactionId"];
      } else if (params.nonce === 33) {
        //@ts-ignore checked abeychain
        txHash = res["returnedHash"] || res.hash;
      } else {
        //@ts-ignore checked normal evm
        txHash = res.hash;
      }

      await notifyValidator(txHash);
      if (params.nonce === 33) {
        return await provider.getTransaction(txHash);
      }
      return res as any;
    },
    async estimateValidateTransferNft(
      _to: string,
      _nftUri: NftInfo<EthNftInfo>,
      _mintWith
    ): Promise<BigNumber> {
      const gas = await provider.getGasPrice();

      return new BigNumber(gas.mul(150_000).toString());
    },
    async estimateContractDep(toChain: any): Promise<BigNumber> {
      try {
        console.log("NEED TO DEPLOY CONTRACT");
        const gas = await provider.getGasPrice();
        const pro = toChain.getProvider();
        const wl = ["0x47Bf0dae6e92e49a3c95e5b0c71422891D5cd4FE"];
        const gk = 123;
        const gkx = 42;
        const factory = new ethers.ContractFactory(
          Minter__factory.abi,
          Minter__factory.bytecode
        );
        const estimateGas = await pro.estimateGas(
          factory.getDeployTransaction(gk, gkx, wl)
        );
        const contractFee = gas.mul(estimateGas);
        const sum = new BigNumber(contractFee.toString());
        return sum;
      } catch (error: any) {
        console.log(error.message);
        const gas = await provider.getGasPrice();
        return new BigNumber(gas.mul(150_000).toString());
      }
    },
    validateAddress(adr) {
      return Promise.resolve(ethers.utils.isAddress(adr));
    },
    isNftWhitelisted(nft) {
      return minter.nftWhitelist(nft.native.contract);
    },
  };
}
