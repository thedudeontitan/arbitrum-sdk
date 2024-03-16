// const { providers, Wallet } = require('ethers')
import { providers, Wallet } from 'ethers'

import { InboxTools } from '../../'
import { ContractTransaction, Signer } from 'ethers'
import { SequencerInbox__factory } from '../../lib/abi/factories/SequencerInbox__factory'
import { Bridge__factory } from '../../lib/abi/factories/Bridge__factory'
import { expect } from 'chai'
import { L2Network, addDefaultLocalNetwork, getL2Network } from '../../lib/dataEntities/networks'
import { BigNumber } from '@ethersproject/bignumber'
import { Inbox__factory } from '../../lib/abi/factories/Inbox__factory'
import { network } from 'hardhat'

/**
 * Set up: instantiate L1 / L2 wallets connected to providers
 */
const walletPrivateKey = "b6b15c8cb491557369f3c7d2c287b053eb229daa9c22138887752191c9520659"

// const l1Provider = new providers.JsonRpcProvider("https://sepolia.infura.io/v3/ed98fbfcd55f46489f27a07dcdbeb869")
// const l2Provider = new providers.JsonRpcProvider("https://arbitrum-sepolia.infura.io/v3/ed98fbfcd55f46489f27a07dcdbeb869")
const l1Provider = new providers.JsonRpcProvider("http://127.0.0.1:8545")
const l2Provider = new providers.JsonRpcProvider("http://127.0.0.1:8547")

const l1Wallet = new Wallet(walletPrivateKey, l1Provider)
const l2Wallet = new Wallet(walletPrivateKey, l2Provider)



const submitL2Tx = async (
  tx: {
    to: string
    value?: BigNumber
    data?: string
    nonce: number
    gasPriceBid: BigNumber
    gasLimit: BigNumber
  },
  l2Network: L2Network,
  l1Signer: Signer
): Promise<ContractTransaction> => {
  const inbox = Inbox__factory.connect(l2Network.ethBridge.inbox, l1Signer)

  return await inbox.sendUnsignedTransaction(
    tx.gasLimit,
    tx.gasPriceBid,
    tx.nonce,
    tx.to,
    tx.value || BigNumber.from(1000000000000000),
    tx.data || '0x'
  )
}

const setup = async () => {

  addDefaultLocalNetwork();

  const signer = l1Wallet
  const provider = signer.provider

  const arbitrumOne = await getL2Network(await l2Wallet.getChainId())

  const sequencerInbox = SequencerInbox__factory.connect(
    arbitrumOne.ethBridge.sequencerInbox,
    provider
  )

  const bridge = Bridge__factory.connect(
    arbitrumOne.ethBridge.bridge,
    provider
  )


  return {
    l1Signer: signer,
    l1Provider: provider,
    l2Network: arbitrumOne,
    sequencerInbox,
    bridge,
  }
}

const mineBlocks = async (
  count: number,
  startTimestamp?: number,
  timeDiffPerBlock = 14
) => {

  let timestamp = startTimestamp
  for (let i = 0; i < count; i++) {
    timestamp = Math.max(
      Math.floor(Date.now() / 1000) + (timeDiffPerBlock || 1),
      (timestamp || 0) + (timeDiffPerBlock || 1)
    )
    await network.provider.send('evm_mine', [timestamp])
  }

}


const main = async () => {


  const { l1Signer, l2Network, sequencerInbox, bridge } = await setup()

  const inboxTools = new InboxTools(l1Signer, l2Network)
  const startInboxLength = await bridge.delayedMessageCount()

  console.log(startInboxLength)

  const l2Tx = await submitL2Tx(
    {
      to: await l1Signer.getAddress(),
      value: BigNumber.from(1000000000000000),
      gasLimit: BigNumber.from(100000),
      gasPriceBid: BigNumber.from(21000000000),
      nonce: 0,
    },
    l2Network,
    l1Signer
  )

  await l2Tx.wait()
  console.log(l2Tx)

  const block = await l1Signer.provider.getBlock('latest')
  await mineBlocks(66000, block.timestamp)

  const forceInclusionTx = await inboxTools.forceInclude()

  expect(forceInclusionTx, 'Null force inclusion').to.not.be.null
  await forceInclusionTx!.wait()

  const messagesReadAfter = await sequencerInbox.totalDelayedMessagesRead()

  console.log(    startInboxLength.add(1)  )
  expect(messagesReadAfter.toNumber(), 'Message not read').to.eq(
    startInboxLength.add(1).toNumber()
  )


}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })