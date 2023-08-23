import { useMutation, useQueryClient } from "@tanstack/vue-query";

import { coreClient, schemas } from "@/api/core/client";
import { constants } from "ethers";
import {
  useReadMusicTokenAllowance,
  useReadMusicTokenInfo,
  useWriteMusicTokenApprove,
} from "@/contracts/musicToken";
import { cabinetQueryKeys } from "@/api/cabinet";
import { OrderParameters } from "@/utils/eip712";
import { useEvm } from "@/evm.config";
import { musicQueryKeys } from "@/api/music";
import { chartsQueryKeys } from "@/api/charts";

const {
  contracts: { useContracts },
} = useEvm();

const orderResponce =
  schemas.music_token_core_internal_handler_response_Response_music_token_core_internal_handler_request_PostOrderBuyResponse_.required();
const orderShema =
  schemas.music_token_core_internal_handler_request_Order.required();
const EIP712Shema =
  schemas.music_token_core_internal_handler_request_EIP712Metadata.required();
const creatorShema =
  schemas.music_token_core_internal_handler_request_CreatorResponse.required();

const checkOrdersFields = (
  responce: Awaited<ReturnType<(typeof coreClient)["confirmBuyOrder"]>>
) => {
  const res = orderResponce.parse(responce);

  const { buy_order, sell_order } = res.data;

  const BuyOrderParsed = orderShema.parse(buy_order?.order);
  const BuyEip712Parsed = EIP712Shema.parse(BuyOrderParsed.EIP712Domain);
  const BuyCreatorParsed = creatorShema.parse(BuyOrderParsed.creator);

  const SellOrderParsed = orderShema.parse(sell_order?.order);
  const SellEip712Parsed = EIP712Shema.parse(SellOrderParsed.EIP712Domain);
  const SellCreatorParsed = creatorShema.parse(SellOrderParsed.creator);

  return {
    buyOrder: {
      ...BuyOrderParsed,
      EIP712Domain: BuyEip712Parsed,
      creator: BuyCreatorParsed,
    },
    sellOrder: {
      ...SellOrderParsed,
      EIP712Domain: SellEip712Parsed,
      creator: SellCreatorParsed,
    },
  };
};

export const useWriteMarketBuyNft = () => {
  const { market } = useContracts();

  const { mutateAsync: approve } = useWriteMusicTokenApprove();
  const { data: allowance } = useReadMusicTokenAllowance(market.address);
  const { data: mtInfo } = useReadMusicTokenInfo();
  const { DEFAULT_CHAINID } = useWallet();
  const qc = useQueryClient();

  const isSigned = ref(false);

  const mutation = useMutation({
    mutationKey: ["buyNft"],
    mutationFn: async ({ ...params }: { orderId: number }) => {
      const { market } = await useWriteContractsOnChain(unref(DEFAULT_CHAINID));

      const res = await coreClient.confirmBuyOrder({
        amount: 1,
        order_id: params.orderId,
      });

      if (!res.data) return defaultEvmResponse();

      const { buy_signature, sell_signature, seller_signature } = res.data;

      const orders = checkOrdersFields(res);

      if (
        (unref(allowance) ?? constants.Zero) <
        orders.sellOrder.price.toBigNumber(0)
      ) {
        const approved = await approve({
          amount: orders.sellOrder.price
            .toBigNumber(0)
            .formatString(unref(mtInfo).decimals),
          spender: market.address,
        });
        if (!approved.success) return defaultEvmResponse();
      }

      const tx = await market.matchOrders(
        {
          order: {
            ...orders.sellOrder,
          },
          signature: sell_signature ?? "",
        },
        {
          order: { ...orders.buyOrder },
          signature: buy_signature ?? "",
        },
        orders.sellOrder.mint ? constants.HashZero : seller_signature ?? ""
      );

      if (!tx) return defaultEvmResponse();

      isSigned.value = true;

      const mined = await tx.wait();

      return { success: Boolean(mined), txInfo: tx };
    },
    onSuccess: () => {
      qc.invalidateQueries(musicQueryKeys._def);
      qc.invalidateQueries(chartsQueryKeys.orders._def);
    },
  });

  return { ...mutation, isSigned };
};

export const useWriteMarketCreateSellOrder = () => {
  const { data: MTInfo } = useReadMusicTokenInfo();
  const { DEFAULT_CHAINID, wallet } = useWallet();
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationKey: ["createSellOrder"],
    mutationFn: async (args: {
      price: number;
      tokenId: number;
      amount: number;
      collectionAddr: string;
    }) => {
      const { anyNft1155, market } = await useWriteContractsOnChain(
        unref(DEFAULT_CHAINID)
      );
      const { price, tokenId, collectionAddr, amount } = args;

      const isApprovedForAll = await anyNft1155(
        collectionAddr
      ).isApprovedForAll(unref(wallet), market.address);

      if (!isApprovedForAll) {
        const approveTx = await anyNft1155(collectionAddr).setApprovalForAll(
          market.address,
          true
        );
        if (!approveTx) return defaultEvmResponse();

        const approved = await approveTx.wait();
        if (!approved) return defaultEvmResponse();
      }

      const priceBN = price.toString().toBigNumber(unref(MTInfo).decimals);

      const order = await coreClient.createSecondaryOrder({
        queries: {
          amount: amount.toString(),
          price: priceBN.toString(),
          token_id: tokenId.toString(),
          collection_addr: collectionAddr,
        },
      });
      if (!order.data) return defaultEvmResponse();

      const orderData = orderShema.parse(order.data.order);
      const creatorData = creatorShema.parse(orderData.creator);
      const domain = EIP712Shema.parse(orderData.EIP712Domain);

      const signature = await eip712OrderSign(domain, {
        ...orderData,
        creator: creatorData,
      });

      if (!signature) return defaultEvmResponse();

      const { success } = await coreClient.confirmSellOrder({
        seller_sign: signature,
        order_id: order.data.order_id ?? -1,
      });
      if (!success) return defaultEvmResponse();

      return { success: true, txInfo: null };
    },
    onSuccess: () => {
      qc.invalidateQueries(cabinetQueryKeys.getUserNfts._def);
      qc.invalidateQueries(cabinetQueryKeys.userOrders._def);
    },
  });

  return mutation;
};

export const useWriteMarketRemoveOrder = () => {
  const qc = useQueryClient();
  const { DEFAULT_CHAINID } = useWallet();
  const mutation = useMutation({
    mutationKey: ["removeOrder"],
    mutationFn: async (args: OrderParameters) => {
      const { market } = await useWriteContractsOnChain(unref(DEFAULT_CHAINID));
      console.log(args);
      const tx = await market.cancelOrder(args);
      if (!tx) return defaultEvmResponse();

      const mined = await tx.wait();
      if (!mined) return defaultEvmResponse();

      return defaultEvmResponse(true, tx);
    },
    onSuccess: () => {
      qc.invalidateQueries(cabinetQueryKeys.getUserNfts._def);
      qc.invalidateQueries(cabinetQueryKeys.userOrders._def);
    },
  });
  return { ...mutation };
};
