import { BN } from "@project-serum/anchor";
import BigNumber from "bignumber.js";
import TonWeb from "tonweb";
import TonWebMnemonic from "tonweb-mnemonic";
import type { Cell } from "tonweb/dist/types/boc/cell";
import { Cell as CellF } from "ton";
import { Chain } from "../consts";
import { EvNotifier } from "../notifier";
import {
  ChainNonceGet,
  EstimateTxFees,
  FeeMargins,
  GetFeeMargins,
  TransferNftForeign,
  UnfreezeForeignNft,
  ValidateAddress,
  BalanceCheck,
} from "./chain";

import { PreTransfer } from "..";

import { BridgeContract } from "./ton-bridge";

import { TonhubConnector, TonhubTransactionResponse } from "ton-x";
import { fromUint8Array } from "js-base64";
import axios from "ton/node_modules/axios";

export type TonSigner = {
  wallet?: TonWallet;
  accIdx: number;
};

export type TonWalletProvider = {
  isTonWallet: boolean;
  send(method: string, params?: any[]): Promise<any>;
  on(eventName: string, handler: (...data: any[]) => any): void;
};

export type TonArgs = {
  wallet: TonhubConnector & TonWalletProvider;
  config: {
    seed?: string;
    appPublicKey?: string;
    address?: string;
  };
};

export type TonNft = {
  nftItemAddr: string;
};

export type TonHelper = ChainNonceGet &
  BalanceCheck &
  PreTransfer<any, any, any> &
  TransferNftForeign<TonSigner, TonNft, string> &
  UnfreezeForeignNft<TonSigner, TonNft, string> &
  EstimateTxFees<TonNft> &
  ValidateAddress & { XpNft: string } & {
    tonKpWrapper: (kp: TonWebMnemonic.KeyPair) => TonSigner;
    tonHubWrapper: (args: TonArgs) => TonSigner;
    tonWalletWrapper: (args: TonArgs) => TonSigner;
  } & GetFeeMargins;

export type TonParams = {
  tonweb: TonWeb;
  notifier: EvNotifier;
  bridgeAddr: string;
  burnerAddr: string;
  xpnftAddr: string;
  feeMargin: FeeMargins;
};

type MethodMap = {
  ton_requestAccounts: [undefined, string];
  ton_sendTransaction: [{ value: string; to: string; data: Cell }, unknown];
  ton_getBalance: [undefined, string];
};

type ResponseUnionType = boolean &
  TonhubTransactionResponse & {
    hash: string;
  };

type TonWallet = {
  send<M extends keyof MethodMap>(
    method: M,
    params: MethodMap[M][0]
  ): Promise<MethodMap[M][1]>;
  handleResponse(res: ResponseUnionType): Promise<string>;
};

export async function tonHelper(args: TonParams): Promise<TonHelper> {
  const bridge = new BridgeContract(args.tonweb.provider, {
    address: args.bridgeAddr,
    burner: args.burnerAddr,
  });

  const ton = args.tonweb as TonWeb & TonWallet;
  ton.provider.sendBoc = (b) =>
    ton.provider.send("sendBocReturnHash", { boc: b });

  async function waitTonTrx(
    exBodyMsg: string,
    address: string,
    msgType: "in_msg" | "out_msgs"
  ) {
    console.log(exBodyMsg, "TON:exBodyMsg");

    let body: string = "";

    const noTrx = setTimeout(() => {
      throw new Error("waitTonTrx timeout");
    }, 60 * 1000 * 20);

    while (!body) {
      console.log("TON:tring to find the trx...");
      await new Promise((r) => setTimeout(r, 10 * 1000));
      //get last 20 trx of address
      const trxs = await ton.provider.getTransactions(address, 20);
      //find body of the trx
      body = trxs.find((trx: any) => {
        const messages = trx[msgType];
        const message = Array.isArray(messages)
          ? messages?.at(0)?.msg_data?.body
          : messages?.msg_data?.body;

        return message === exBodyMsg;
      })?.data;
    }

    clearTimeout(noTrx);

    const dict = CellF.fromBoc(Buffer.from(body, "base64"))[0].hash();

    const exHash = dict.toString("base64");
    console.log(exHash, "exHash");
    await new Promise((r) => setTimeout(r, 6 * 1000));
    const trxArr = await axios(
      `https://toncenter.com/api/index/getTransactionByHash?tx_hash=${encodeURIComponent(
        exHash
      )}&include_msg_body=true`
    );

    return trxArr.data[0]["in_msg"].hash;
  }

  return {
    preTransfer: () => Promise.resolve(true),
    preUnfreeze: () => Promise.resolve(true),
    getNonce: () => Chain.TON,
    XpNft: args.xpnftAddr,
    async balance(address: string) {
      return new BigNumber(await ton.getBalance(address));
    },
    async estimateValidateTransferNft() {
      return new BigNumber(0); // TODO
    },
    async estimateValidateUnfreezeNft() {
      return new BigNumber(0); // TODO
    },
    async validateAddress(adr) {
      return TonWeb.Address.isValid(adr);
    },
    getFeeMargin() {
      return args.feeMargin;
    },
    async transferNftToForeign(signer, chainNonce, to, nft, txFees, mintWith) {
      const rSigner = signer.wallet || ton;

      const txFeesFull = new BN(txFees.toString(10));
      const nftFee = TonWeb.utils.toNano("0.07");

      const payload = await bridge.createFreezeBody({
        amount: txFeesFull.sub(nftFee),
        to: Buffer.from(to),
        chainNonce,
        mintWith: Buffer.from(mintWith),
      });

      console.log("TON:transferNftToForeign");
      console.log(rSigner);
      const res = (await rSigner.send("ton_sendTransaction", {
        value: txFeesFull.toString(10),
        to: nft.native.nftItemAddr,
        data: payload,
      })) as ResponseUnionType;

      const hash = await rSigner.handleResponse(res);

      await args.notifier.notifyTon(hash);

      return hash;
    },
    async unfreezeWrappedNft(signer, to, nft, _txFees, chainNonce) {
      const rSigner = signer.wallet || ton;

      const txFeesFull = TonWeb.utils.toNano("0.08");
      const nftFee = TonWeb.utils.toNano("0.05");
      const payload = await bridge.createWithdrawBody({
        to: new Uint8Array(Buffer.from(to)),
        chainNonce: parseInt(chainNonce),
        txFees: txFeesFull.sub(nftFee),
      });
      console.log("TON:unfreezeWrappedNft");
      const res = (await rSigner.send("ton_sendTransaction", {
        value: txFeesFull.toString(10),
        to: nft.native.nftItemAddr,
        data: payload,
      })) as ResponseUnionType;

      const hash = await rSigner.handleResponse(res);

      await args.notifier.notifyTon(hash);

      return hash;
    },
    tonWalletWrapper(args: TonArgs) {
      let payload: string = "";
      const tonHub: TonWallet = {
        async send(method, params) {
          switch (method) {
            case "ton_sendTransaction":
              payload = fromUint8Array(await params!.data.toBoc(false));
              return await args.wallet.send("ton_sendTransaction", [
                {
                  to: params!.to,
                  value: new BN(params!.value).toString(),
                  dataType: "boc",
                  data: payload,
                },
              ]);
            default:
              return null;
          }
        },

        async handleResponse(res: boolean) {
          return (
            res && (await waitTonTrx(payload, args.config.address!, "out_msgs"))
          );
        },
      };

      return {
        wallet: tonHub,
        accIdx: 0,
      };
    },
    tonHubWrapper(args: TonArgs) {
      const tonHub: TonWallet = {
        async send(method, params) {
          switch (method) {
            case "ton_sendTransaction":
              return await args.wallet.requestTransaction({
                seed: args.config.seed!,
                appPublicKey: args.config.appPublicKey!,
                to: params!.to,
                value: new BN(params!.value).toString(),
                timeout: 5 * 60 * 1000,
                text: `ton_sendTransaction to ${params!.to}`,
                payload: fromUint8Array(await params!.data.toBoc(false)),
              });

            default:
              return null;
          }
        },

        async handleResponse(res: TonhubTransactionResponse) {
          if (res.type === "success" && res.response != undefined) {
            return await waitTonTrx(
              res.response,
              args.config.address!,
              "in_msg"
            );
          } else {
            throw new Error(`TonHub:${res.type}`);
          }
        },
      };

      return {
        wallet: tonHub,
        accIdx: 0,
      };
    },
    tonKpWrapper(kp: TonWebMnemonic.KeyPair): TonSigner {
      const wallet = new TonWeb.Wallets.all.v3R2(ton.provider, {
        publicKey: kp.publicKey,
        wc: 0,
      });

      const wWallet: TonWallet = {
        async send(method, params) {
          switch (method) {
            case "ton_getBalance":
              return await ton.getBalance(await wallet.getAddress());
            case "ton_requestAccounts":
              return [await wallet.getAddress()];
            case "ton_sendTransaction":
              return await wallet.methods
                .transfer({
                  secretKey: kp.secretKey,
                  toAddress: params!.to,
                  amount: new BN(params!.value),
                  seqno: (await wallet.methods.seqno().call()) || 0,
                  sendMode: 3,
                  payload: params!.data,
                })
                .send();
          }
        },
        async handleResponse(res: { hash: string }) {
          return res.hash;
        },
      };

      return {
        wallet: wWallet,
        accIdx: 0,
      };
    },
  };
}

/**
 * 
 *     const ton = new TonWeb(
      new TonWeb.HttpProvider("https://toncenter.com/api/v2/jsonRPC", {
        apiKey:
          "05645d6b549f33bf80cee8822bd63df720c6781bd00020646deb7b2b2cd53b73",
      })
    );

    const trxs = await ton.provider.getTransactions(
      "EQBhSfdrfydwE4Sl4-sWUYhNHsQcVTGR3p2JA14C2_PNdgfs",
      20
    );

    console.log(trxs);

    let data = new Cell();
    console.log(data);
    const dict = Cell.fromBoc(
      Buffer.from(
        "te6cckECDAEAAtkAA7V2FJ92t/J3AThKXj6xZRiE0exBxVMZHenYkDXgLb8812AAAdm2v+2EFpyXsCyPQOlDXCGvDlGdb9/YPNRPgD98AgAsIvgTYcYAAAHZqugyeDY2O1EgADRtIKRIAQIDAgHgBAUAgnIXMm/rsAMDO9FDdU/1I47b332HXYKcIvfN53pZj/VL8XxAXw8HICdzOmVFlgwy6XfTfJTbuplVQh4PnMQir/B3AhEMgouGGZPPBEAKCwHhiADCk+7W/k7gJwlLx9YsoxCaPYg4qmMjvTsSBrwFt+ea7AHPX0P+BlViv5FLRo4uUALd1xnuqimnA//t0BCCufv3iVjYINGcRw+ljDnirrtKYcGN629BfyEuTEj2eIBH7pAxTU0YuxsdqmAAAABAABwGAQHfBwFoYgBuLG9sHzPjFfimuHMhmTMm2J2PjG2QS0wA58SpRc6PpiAmJaAAAAAAAAAAAAAAAAAAAQgBsWgAwpPu1v5O4CcJS8fWLKMQmj2IOKpjI707Ega8Bbfnmu0ANxY3tg+Z8Yr8U1w5kMyZk2xOx8Y2yCWmAHPiVKLnR9MQExLQAAYuoZgAADs21/2whMbHaiTACAGfX8w9FAAAAAAAAAAAgAhTrcJncddU9sZlDMvNz2ZSqJDp5YplXYGBr0ckiINkEAPcWJzy2hGXRIgyzC2jzCbLkfjUINlQYAjIgr3kCXkEFBgJAHIHACoweDQ3QmYwZGFlNmU5MmU0OWEzYzk1ZTViMGM3MTQyMjg5MUQ1Y2Q0RkUAAAAAAAAAAAAAAAAAnUGdgxOIAAAAAAAAAAARAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAb8mRfJBMLqFQAAAAAAACAAAAAAADChE7JLQbmSipXzKEUnUNwnWjHPBXefxRxAbt/uNGHeZA0DgsouCJ3A==",
        "base64"
      )
    )[0].hash();
    console.log("Hash: " + dict.toString("base64"));
 */
