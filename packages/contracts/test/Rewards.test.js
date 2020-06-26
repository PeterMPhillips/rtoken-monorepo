const ERC20Mintable = artifacts.require("ERC20Mintable");
const CErc20 = artifacts.require("CErc20");
const ComptrollerMock = artifacts.require("ComptrollerMock");
const InterestRateModelMock = artifacts.require("InterestRateModelMock");
const CompoundAllocationStrategy = artifacts.require("CompoundAllocationStrategy");
const RToken = artifacts.require("RToken");
const Proxy = artifacts.require("Proxy");
const { time, expectRevert } = require("@openzeppelin/test-helpers");
const { web3tx, wad4human, toWad } = require("@decentral.ee/web3-test-helpers");

contract("RTokenRewards", accounts => {
    const MAX_UINT256 = "115792089237316195423570985008687907853269984665640564039457584007913129639935";
    const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

    const admin = accounts[0];
    const bingeBorrower = accounts[1];
    const customer1 = accounts[2];
    const customer2 = accounts[3];
    const customer3 = accounts[4];
    const customer4 = accounts[5];
    let token;
    let cToken;
    let rewardToken;
    let compoundAS;
    let rToken;
    let rTokenLogic;
    let SELF_HAT_ID;


    async function createCompoundAllocationStrategy(cTokenExchangeRate) {
        const comptroller = await web3tx(ComptrollerMock.new, "ComptrollerMock.new")({ from: admin });
        const interestRateModel = await web3tx(InterestRateModelMock.new, "InterestRateModelMock.new")({ from: admin });
        const cToken = await web3tx(CErc20.new, "CErc20.new")(
            token.address,
            comptroller.address,
            interestRateModel.address,
            cTokenExchangeRate, // 1 cToken == cTokenExchangeRate * token
            "Compound token",
            "cToken",
            18, {
                from: admin
            });
        const compoundAS = await web3tx(CompoundAllocationStrategy.new, "CompoundAllocationStrategy.new")(
            cToken.address, {
                from: admin
            }
        );
        return { cToken, compoundAS };
    }

    before(async () => {
        console.log("admin is", admin);
        console.log("bingeBorrower is", bingeBorrower);
        console.log("customer1 is", customer1);
        console.log("customer2 is", customer2);
        console.log("customer3 is", customer3);
    });

    beforeEach(async () => {
        token = await web3tx(ERC20Mintable.new, "ERC20Mintable.new")({ from: admin });
        await web3tx(token.mint, "token.mint 1000 -> customer1")(customer1, toWad(1000), { from: admin });

        rewardToken = await web3tx(ERC20Mintable.new, "ERC20Mintable.new")({ from: admin });
        await web3tx(rewardToken.mint, "rewardToken.mint 1000 -> admin")(admin, toWad(1000), { from: admin });

        {
            const result = await createCompoundAllocationStrategy(toWad(.1));
            cToken = result.cToken;
            compoundAS = result.compoundAS;
        }

        // Deploy the rToken logic/library contract
        rTokenLogic = await web3tx(RToken.new, "RToken.new")(
            {
                from: admin
            });
        // Get the init code for rToken
        const rTokenConstructCode = rTokenLogic.contract.methods.initialize(
            compoundAS.address,
            "RToken Test",
            "RTOKEN",
            18).encodeABI();

        // Deploy the Proxy, using the init code for rToken
        const proxy = await web3tx(Proxy.new, "Proxy.new")(
            rTokenConstructCode, rTokenLogic.address, {
                from: admin
            });
        // Create the rToken object using the proxy address
        rToken = await RToken.at(proxy.address);

        await web3tx(compoundAS.transferOwnership, "compoundAS.transferOwnership")(rToken.address);
        SELF_HAT_ID = await rToken.SELF_HAT_ID.call();
    });

    function zeroHatUseCount(u) {
        return web3.utils.toBN(MAX_UINT256).sub(web3.utils.toBN(u)).toString();
    }

    function parseHat({hatID, recipients, proportions}) {
        const hatObj = {
            recipients: recipients,
            proportions: proportions.map(i=>i.toNumber())
        };
        if (typeof(hatID) !== "undefined") {
            hatObj.hatID = hatID.toNumber();
        }
        return hatObj;
    }

    function parseHatStats({useCount, totalLoans, totalSavings}) {
        return {
            useCount,
            totalLoans: wad4human(totalLoans),
            totalSavings: wad4human(totalSavings)
        };
    }

    function parseGlobalStats({totalSupply, totalSavingsAmount}) {
        return {
            totalSupply: wad4human(totalSupply),
            totalSavingsAmount: wad4human(totalSavingsAmount)
        };
    }

    function parseSavingAssetBalance({rAmount, sOriginalAmount}) {
        return {
            rAmount: wad4human(rAmount),
            sOriginalAmount: wad4human(sOriginalAmount)
        };
    }

    async function doBingeBorrowing(nBlocks = 100) {
        // this process should generate 0.0001% * nBlocks amount of tokens worth of interest
        // when nBlocks = 100, it is 0.001

        console.log(`Before binge borrowing: 1 cToken = ${wad4human(await cToken.exchangeRateStored.call())} Token`);
        // for testing purpose, our mock doesn't even check if there is
        // sufficient collateral in the system!!
        const borrowAmount = toWad(10);
        await web3tx(cToken.borrow, "cToken.borrow 10 to bingeBorrower", {
            inLogs: [{
                name: "Borrow"
            }]
        })(borrowAmount, {
            from: bingeBorrower
        });
        await waitForInterest(nBlocks);
        console.log(`After binge borrowing: 1 cToken = ${wad4human(await cToken.exchangeRateStored.call())} Token`);
    }

    async function waitForInterest(nBlocks = 100) {
        console.log(`Wait for ${nBlocks} blocks...`);
        while(--nBlocks) await time.advanceBlock();
        await web3tx(cToken.accrueInterest, "cToken.accrueInterest")({ from: admin });
    }

    async function expectAccount(account, balances, decimals) {
        let accountName;
        if (account === admin) accountName = "admin";
        else if (account === customer1) accountName = "customer1";
        else if (account === customer2) accountName = "customer2";
        else if (account === customer3) accountName = "customer3";
        else if (account === customer4) accountName = "customer4";

        const tokenBalance = wad4human(await rToken.balanceOf.call(account), decimals);
        console.log(`${accountName} tokenBalance ${tokenBalance} expected ${balances.tokenBalance}`);

        const receivedLoan = wad4human(await rToken.receivedLoanOf.call(account), decimals);
        console.log(`${accountName} receivedLoan ${receivedLoan} expected ${balances.receivedLoan}`);

        const receivedSavings = wad4human(await rToken.receivedSavingsOf.call(account), decimals);
        console.log(`${accountName} receivedSavings ${receivedSavings} expected ${balances.receivedSavings}`);

        const interestPayable = wad4human(await rToken.interestPayableOf.call(account), decimals);
        console.log(`${accountName} interestPayable ${interestPayable} expected ${balances.interestPayable}`);

        const accountStats = await rToken.getAccountStats.call(account);

        const cumulativeInterest = wad4human(accountStats.cumulativeInterest, decimals);
        console.log(`${accountName} cumulativeInterest ${cumulativeInterest} expected ${balances.cumulativeInterest}`);

        console.log(`${accountName} lDebt ${wad4human(accountStats.lDebt)}`);
        console.log(`${accountName} rInterest ${wad4human(accountStats.rInterest)}`);
        console.log(`${accountName} sInternalAmount ${wad4human(accountStats.sInternalAmount)}`);

        assert.equal(
            wad4human(
                web3.utils.toBN(accountStats.rAmount),
                12),
            wad4human(
                web3.utils.toBN(accountStats.lRecipientsSum)
                    .add(web3.utils.toBN(accountStats.rInterest)),
                12),
            "account invariant: rAmount = lRecipientsSum + rInterest");

        assert.deepEqual({
            tokenBalance,
            receivedLoan,
            receivedSavings,
            interestPayable,
            cumulativeInterest
        }, balances, `expectAccount ${accountName}`);
    }

    async function validateGlobalInvariants() {
        const accounts = [admin, customer1, customer2, customer3, customer4];
        let totalSupplyByAccounts = toWad(0);
        let totalSavingsAmountByAccounts = toWad(0);
        let totalReceivedLoansByAccounts = toWad(0);
        let totalDebtFreeInterestByAccounts = toWad(0);

        for (let i = 0; i < accounts.length; ++i) {
            const account = accounts[i];
            const stats = await rToken.getAccountStats.call(account);
            totalSupplyByAccounts = totalSupplyByAccounts
                .add(web3.utils.toBN(await rToken.balanceOf.call(account)));
            totalSavingsAmountByAccounts = totalSavingsAmountByAccounts
                .add(web3.utils.toBN(await rToken.receivedSavingsOf.call(account)));
            totalReceivedLoansByAccounts = totalReceivedLoansByAccounts
                .add(web3.utils.toBN(await rToken.receivedLoanOf.call(account)));
            totalDebtFreeInterestByAccounts = totalDebtFreeInterestByAccounts
                .add(web3.utils.toBN(stats.cumulativeInterest))
                .sub(web3.utils.toBN(stats.rInterest));
        }

        const globalStats = await rToken.getGlobalStats.call();
        assert.deepEqual({
            totalSupply: totalSupplyByAccounts.toString(),
            totalSavingsAmount: wad4human(totalSavingsAmountByAccounts, 12)
        }, {
            totalSupply: globalStats.totalSupply.toString(),
            totalSavingsAmount: wad4human(globalStats.totalSavingsAmount, 12)
        }, "invariants: accountStats vs globalStats");

        const nHats = parseInt((await rToken.getMaximumHatID.call()).toString()) + 1;
        let totalReceivedLoansByHats = toWad(0);
        let totalSavingsByHats = toWad(0);
        for (let i = 0; i <= nHats; ++i) {
            let hatID = i;
            if (i === nHats) hatID = SELF_HAT_ID;
            const stats = await rToken.getHatStats.call(hatID);
            totalReceivedLoansByHats = totalReceivedLoansByHats
                .add(web3.utils.toBN(stats.totalLoans));
            totalSavingsByHats = totalSavingsByHats
                .add(web3.utils.toBN(stats.totalSavings));
        }
        assert.deepEqual({
            totalReceivedLoans: totalReceivedLoansByAccounts.toString(),
            totalSavings: wad4human(totalSavingsAmountByAccounts.add(totalDebtFreeInterestByAccounts), 6),
        }, {
            totalReceivedLoans: totalReceivedLoansByHats.toString(),
            totalSavings: wad4human(totalSavingsByHats, 6),
        }, "invariants: accountStats vs hatStats");
    }

    it("#0 initial test condition", async () => {
        assert.equal(wad4human(await rToken.totalSupply.call()), "0.00000");
        assert.equal(wad4human(await cToken.balanceOf.call(customer1)), "0.00000");
        assert.equal(wad4human(await token.balanceOf.call(customer1)), "1000.00000");
    });

    it("#1 normal operations with zero hatter", async () => {
        // STEP 1: mint 100 -> customer1
        await web3tx(token.approve, "token.approve 100 by customer1")(rToken.address, toWad(100), {
            from: customer1
        });
        await expectRevert(rToken.mint(toWad(100.1), { from: customer1 }), "Not enough allowance");
        await web3tx(rToken.mint, "rToken.mint 100 to customer1", {
            inLogs: [{
                name: "Transfer",
                args: {
                    from: ZERO_ADDRESS,
                    to: customer1,
                    value: toWad(100)
                }
            }]
        })(toWad(100), { from: customer1 });
        assert.equal(wad4human(await token.balanceOf.call(customer1)), "900.00000");
        assert.equal(wad4human(await rToken.balanceOf.call(customer1)), "100.00000");
        await expectAccount(customer1, {
            tokenBalance: "100.00000",
            cumulativeInterest: "0.00000",
            receivedLoan: "100.00000",
            receivedSavings: "100.00000",
            interestPayable: "0.00000",
        });

        // STEP 2: binge borrowing
        await doBingeBorrowing();
        await expectAccount(customer1, {
            tokenBalance: "100.00000",
            cumulativeInterest: "0.00000",
            receivedLoan: "100.00000",
            receivedSavings: "100.00100",
            interestPayable: "0.00100",
        });
        assert.deepEqual(parseGlobalStats(await rToken.getGlobalStats.call()), {
            totalSupply: "100.00000",
            totalSavingsAmount: "100.00100"
        });
        await expectRevert(rToken.redeem("0", { from: customer1 }), "Redeem amount cannot be zero");

        // Distribute reward token to Allocation Strategy
        await web3tx(rewardToken.transfer, "rewardToken.transfer 10 by admin")(compoundAS.address, toWad(10), {
            from: admin
        });
        assert.equal(wad4human(await rewardToken.balanceOf.call(compoundAS.address)), "10.00000");
        await expectRevert(rToken.collectRewards({ from: admin }), "Rewards token not set");
        await web3tx(rToken.setRewardsToken, "rToken.setRewardsToken as rewardToken")(rewardToken.address, {
            from: admin
        });
        await expectRevert(rToken.collectRewards({ from: admin }), "msg.sender not withdrawAddress");
        await web3tx(rToken.setWithdrawAddress, "rToken.setWithdrawAddress as rToken")(rToken.address, {
            from: admin
        });
        await web3tx(rToken.collectRewards, "rToken.collectedRewards 10 from compoundAS")({
            from: admin
        });
        assert.equal(wad4human(await rewardToken.balanceOf.call(rToken.address)), "10.00000");
        assert.equal(wad4human(await rToken.getRewardsOwed.call(customer1)), "10.00000");

        // STEP 3: redeem 10 by customer1
        await web3tx(rToken.redeem, "rToken.redeem 10 by customer1", {
            inLogs: [{
                name: "Transfer",
                args: {
                    from: customer1,
                    to: ZERO_ADDRESS,
                    value: toWad(10)
                }
            }]
        })(toWad(10), { from: customer1 });
        assert.equal(wad4human(await token.balanceOf.call(customer1)), "910.00000");
        assert.equal(wad4human(await rToken.balanceOf.call(customer1)), "90.00108");
        await expectAccount(customer1, {
            tokenBalance: "90.00108",
            cumulativeInterest: "0.00108",
            receivedLoan: "90.00000",
            receivedSavings: "90.00108",
            interestPayable: "0.00000",
        });

        // STEP 5: payInterest to customer1
        await web3tx(rToken.payInterest, "rToken.payInterest to customer1", {
            inLogs: [{
                name: "InterestPaid"
            }, {
                name: "Transfer",
                args: {
                    from: ZERO_ADDRESS,
                    to: customer1
                    // value: // who knows
                }
            }]
        })(customer1, { from : admin });
        assert.equal(wad4human(await token.balanceOf.call(customer1)), "910.00000");
        assert.equal(wad4human(await rToken.balanceOf.call(customer1)), "90.00109");
        await expectAccount(customer1, {
            tokenBalance: "90.00109",
            cumulativeInterest: "0.00109",
            receivedLoan: "90.00000",
            receivedSavings: "90.00109",
            interestPayable: "0.00000",
        });
        await web3tx(rToken.payInterest, "rToken.payInterest to customer1 again", {
            inLogs: [{
                name: "InterestPaid"
            }]
        })(customer1, { from : admin });
        await expectAccount(customer1, {
            tokenBalance: "90.00110",
            cumulativeInterest: "0.00110",
            receivedLoan: "90.00000",
            receivedSavings: "90.00110",
            interestPayable: "0.00000",
        });
        assert.deepEqual(parseGlobalStats(await rToken.getGlobalStats.call()), {
            totalSupply: "90.00110",
            totalSavingsAmount: "90.00110"
        });

        // STEP 6: redeem 2 by customer1 and transfer to customer2
        await web3tx(rToken.redeemAndTransfer, "rToken.redeem 2 of customer1 to customer2", {
            inLogs: [{
                name: "Transfer",
                args: {
                    from: customer1,
                    to: ZERO_ADDRESS,
                    value: toWad(2)
                }
            }]
        })(customer2, toWad(2), { from: customer1 });
        assert.equal(wad4human(await token.balanceOf.call(customer2)), "2.00000");
        assert.equal(wad4human(await rewardToken.balanceOf.call(customer1)), "10.00000");

        // Distribute reward token to Allocation Strategy
        await web3tx(rewardToken.transfer, "rewardToken.transfer 10 by admin")(compoundAS.address, toWad(10), {
            from: admin
        });
        assert.equal(wad4human(await rewardToken.balanceOf.call(compoundAS.address)), "10.00000");
        await web3tx(rToken.collectRewards, "rToken.collectedRewards 10 from compoundAS")({
            from: admin
        });
        assert.equal(wad4human(await rewardToken.balanceOf.call(rToken.address)), "10.00000");
        //console.log("Customer1 rewards: ", wad4human(await rToken.getRewardsOwed.call(customer1)));
        assert.equal(wad4human(await rToken.getRewardsOwed.call(customer1)), "10.00000");

        // Mint more
        await web3tx(token.approve, "token.approve 2 by customer2")(rToken.address, toWad(2), {
            from: customer2
        });
        await web3tx(rToken.mint, "rToken.mint 2 to customer2", {
            inLogs: [{
                name: "Transfer",
                args: {
                    from: ZERO_ADDRESS,
                    to: customer2,
                    value: toWad(2)
                }
            }]
        })(toWad(2), { from: customer2 });

        assert.equal(wad4human(await rToken.getRewardsOwed.call(customer1)), "10.00000");
        assert.equal(wad4human(await rToken.getRewardsOwed.call(customer2)), "0.00000");

        await web3tx(rewardToken.transfer, "rewardToken.transfer 10 by admin")(compoundAS.address, toWad(10), {
            from: admin
        });
        assert.equal(wad4human(await rewardToken.balanceOf.call(compoundAS.address)), "10.00000");
        await web3tx(rToken.collectRewards, "rToken.collectedRewards 10 from compoundAS")({
            from: admin
        });
        assert.equal(wad4human(await rewardToken.balanceOf.call(rToken.address)), "20.00000");
        console.log("Customer1 rewards: ", wad4human(await rToken.getRewardsOwed.call(customer1)));
        console.log("Customer2 rewards: ", wad4human(await rToken.getRewardsOwed.call(customer2)));
        assert.equal(wad4human(web3.utils.toBN(await rToken.getRewardsOwed.call(customer1)).add(await rToken.getRewardsOwed.call(customer2))), "20.00000");

        // STEP 7: transfer 10 from customer 1 to customer 3
        // some invalid tranfers
        await expectRevert(rToken.transfer(customer1, toWad(1), { from: customer1 }), "src should not equal dst");
        await expectRevert(rToken.transfer(customer2, toWad(100.1), { from: customer1 }), "Not enough balance to transfer");
        await expectRevert(rToken.transferFrom(customer1, customer2, toWad(1), { from: admin }), "Not enough allowance for transfer");
        await web3tx(rToken.transfer, "rToken.transfer 10 from customer1 to customer3", {
            inLogs: [{
                name: "Transfer",
                args: {
                    from: customer1,
                    to: customer3,
                    value: toWad(10)
                }
            }]
        })(customer3, toWad(10), { from: customer1 });
        await expectAccount(customer1, {
            tokenBalance: "78.00121",
            cumulativeInterest: "0.00121",
            receivedLoan: "78.00000",
            receivedSavings: "78.00121",
            interestPayable: "0.00000",
        });
        await expectAccount(customer3, {
            tokenBalance: "10.00000",
            cumulativeInterest: "0.00000",
            receivedLoan: "10.00000",
            receivedSavings: "10.00000",
            interestPayable: "0.00000",
        });

        // STEP 7: transfer 5 from customer 3 to customer 1
        await web3tx(rToken.transfer, "rToken.transfer 5 from customer3 to customer1", {
            inLogs: [{
                name: "Transfer",
                args: {
                    from: customer3,
                    to: customer1,
                    value: toWad(5)
                }
            }]
        })(customer1, toWad(5), { from: customer3 });
        await expectAccount(customer1, {
            tokenBalance: "83.00122",
            cumulativeInterest: "0.00122",
            receivedLoan: "83.00000",
            receivedSavings: "83.00122",
            interestPayable: "0.00000",
        });
        await expectAccount(customer2, {
            tokenBalance: "2.00000",
            cumulativeInterest: "0.00000",
            receivedLoan: "2.00000",
            receivedSavings: "2.00000",
            interestPayable: "0.00000",
        });
        await expectAccount(customer3, {
            tokenBalance: "5.00000",
            cumulativeInterest: "0.00000",
            receivedLoan: "5.00000",
            receivedSavings: "5.00000",
            interestPayable: "0.00000",
        });

        // Validate global stats
        await validateGlobalInvariants();
        assert.deepEqual(parseGlobalStats(await rToken.getGlobalStats.call()), {
            totalSupply: "90.00122",
            totalSavingsAmount: "90.00122"
        });
        assert.deepEqual(parseHatStats(await rToken.getHatStats(0)), {
            useCount: zeroHatUseCount(0),
            totalLoans: "90.00000",
            totalSavings: "90.00122",
        });
    });
});
