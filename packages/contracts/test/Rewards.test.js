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
    const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
    const FEE = 0.1;

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
    });

    function parseGlobalStats({totalSupply, totalSavingsAmount}) {
        return {
            totalSupply: wad4human(totalSupply),
            totalSavingsAmount: wad4human(totalSavingsAmount)
        };
    }

    function parseRemainderAfterFee(amount) {
        return (amount - (amount*FEE)).toFixed(5);
    }

    async function doWithdrawReward(name, from, reward) {
        const balance = await reward.balanceOf.call(from);
        const owed = await rToken.getRewardsOwed.call(from);
        console.log(`${name} rewards: `, wad4human(owed));
        await web3tx(rToken.withdrawRewards, `rToken.withdrawRewards for ${name}`)({
            from: from
        });
        assert.equal(
            wad4human(web3.utils.toBN(balance).add(owed)),
            wad4human(await reward.balanceOf.call(from)),
            "rewards token: new balance = old balance + rewards owed");
        assert.equal(wad4human(await rToken.getRewardsOwed.call(from)), "0.00000");
    }

    async function doPastWithdrawReward(name, from, reward) {
        const balance = await reward.balanceOf.call(from);
        const owed = await rToken.getPastRewardsOwed.call(from, reward.address);
        console.log(`${name} rewards: `, wad4human(owed));
        await web3tx(rToken.withdrawPastRewards, `rToken.withdrawPastRewards for ${name}`)(reward.address, {
            from: from
        });
        assert.equal(
            wad4human(web3.utils.toBN(balance).add(owed)),
            wad4human(await reward.balanceOf.call(from)),
            "rewards token: new balance = old balance + rewards owed");
        assert.equal(wad4human(await rToken.getPastRewardsOwed.call(from, reward.address)), "0.00000");
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

    it("#1 normal operations with rewards", async () => {
        // mint 100 -> customer1
        await web3tx(token.approve, "token.approve 100 by customer1")(rToken.address, toWad(100), {
            from: customer1
        });
        await web3tx(rToken.mintWithNewHat, "rToken.mint 100 to customer1 with a hat benefiting customer1(90%) and customer2(10%)")(
            toWad(100), [customer1, customer2], [90, 10], { from: customer1 });
        assert.equal(wad4human(await token.balanceOf.call(customer1)), "900.00000");
        assert.equal(wad4human(await rToken.balanceOf.call(customer1)), "100.00000");
        await expectAccount(customer1, {
            tokenBalance: "100.00000",
            cumulativeInterest: "0.00000",
            receivedLoan: "90.00000",
            receivedSavings: "90.00000",
            interestPayable: "0.00000",
        });
        await expectAccount(customer2, {
            tokenBalance: "0.00000",
            cumulativeInterest: "0.00000",
            receivedLoan: "10.00000",
            receivedSavings: "10.00000",
            interestPayable: "0.00000",
        });

        // binge borrowing
        await doBingeBorrowing();
        await expectAccount(customer1, {
            tokenBalance: "100.00000",
            cumulativeInterest: "0.00000",
            receivedLoan: "90.00000",
            receivedSavings: "90.00090",
            interestPayable: "0.00090",
        });
        await expectAccount(customer2, {
            tokenBalance: "0.00000",
            cumulativeInterest: "0.00000",
            receivedLoan: "10.00000",
            receivedSavings: "10.00010",
            interestPayable: "0.00010",
        });
        assert.deepEqual(parseGlobalStats(await rToken.getGlobalStats.call()), {
            totalSupply: "100.00000",
            totalSavingsAmount: "100.00100"
        });

        // Distribute reward token to Allocation Strategy
        await web3tx(rewardToken.mint, "rewardToken.mint 10 -> compoundAS")(compoundAS.address, toWad(10), {
            from: admin
        });
        assert.equal(wad4human(await rewardToken.balanceOf.call(compoundAS.address)), "10.00000");
        // Collect rewards to rToken
        await expectRevert(rToken.collectRewards({ from: admin }), "Rewards token not set");
        await expectRevert(rToken.setRewardsToken(ZERO_ADDRESS, { from: admin }), "Rewards token cannot be null address");
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
        assert.equal(wad4human(await rToken.getRewardsOwed.call(customer1)), "9.00000");
        assert.equal(wad4human(await rToken.getRewardsOwed.call(customer2)), "1.00000");

        // STEP 3: redeem 10 by customer1
        await web3tx(rToken.redeem, "rToken.redeem 10 by customer1")(toWad(10), { from: customer1 });
        assert.equal(wad4human(await token.balanceOf.call(customer1)), "910.00000");
        assert.equal(wad4human(await rToken.balanceOf.call(customer1)), "90.00097");
        await expectAccount(customer1, {
            tokenBalance: "90.00097",
            cumulativeInterest: "0.00097",
            receivedLoan: "81.00000",
            receivedSavings: "81.00097",
            interestPayable: "0.00000",
        });
        await expectAccount(customer2, {
            tokenBalance: "0.00000",
            cumulativeInterest: "0.00000",
            receivedLoan: "9.00000",
            receivedSavings: "9.00011",
            interestPayable: "0.00011",
        });

        // payInterest to customer1 + customer2
        await web3tx(rToken.payInterest, "rToken.payInterest to customer1")(customer1, {
            from : admin
        });
        await web3tx(rToken.payInterest, "rToken.payInterest to customer2")(customer2, {
            from : admin
        });
        assert.equal(wad4human(await token.balanceOf.call(customer1)), "910.00000");
        assert.equal(wad4human(await rToken.balanceOf.call(customer1)), "90.00098");
        assert.equal(wad4human(await rToken.balanceOf.call(customer2)), "0.00011");
        await expectAccount(customer1, {
            tokenBalance: "90.00098",
            cumulativeInterest: "0.00098",
            receivedLoan: "81.00000",
            receivedSavings: "81.00099",
            interestPayable: "0.00001",
        });
        await expectAccount(customer2, {
            tokenBalance: "0.00011",
            cumulativeInterest: "0.00011",
            receivedLoan: "9.00000",
            receivedSavings: "9.00011",
            interestPayable: "0.00000",
        });
        await web3tx(rToken.payInterest, "rToken.payInterest to customer1 again")(customer1, {
            from : admin
        });
        await expectAccount(customer1, {
            tokenBalance: "90.00100",
            cumulativeInterest: "0.00100",
            receivedLoan: "81.00000",
            receivedSavings: "81.00100",
            interestPayable: "0.00000",
        });
        assert.deepEqual(parseGlobalStats(await rToken.getGlobalStats.call()), {
            totalSupply: "90.00111",
            totalSavingsAmount: "90.00111"
        });

        // redeem 2 by customer1 and transfer to customer2 (adn withdraw rewards for customer1)
        await web3tx(rToken.redeemAndTransfer, "rToken.redeem 2 of customer1 to customer2")(customer2, toWad(2), {
            from: customer1
        });
        assert.equal(wad4human(await token.balanceOf.call(customer2)), "2.00000");
        assert.equal(wad4human(await rewardToken.balanceOf.call(customer1)), "9.00000");
        await doWithdrawReward("customer2", customer2, rewardToken);

        // Set reward token fee
        await expectRevert(rToken.setRewardsFee(toWad(0.1), { from: customer1 }), "Ownable: caller is not the owner");
        await expectRevert(rToken.setRewardsFee(toWad(1), { from: admin }), "Fee cannot be 100% or above");
        await web3tx(rToken.setRewardsFee, "rToken.setRewardsFee 10% by admin")(toWad(0.1), {
            from: admin
        });
        // Distribute reward token to Allocation Strategy
        await web3tx(rewardToken.mint, "rewardToken.mint 10 -> compoundAS")(compoundAS.address, toWad(10), {
            from: admin
        });
        await web3tx(rToken.collectRewards, "rToken.collectedRewards 10 from compoundAS")({
            from: admin
        });
        assert.equal(wad4human(await rToken.getRewardsOwed.call(customer1)), parseRemainderAfterFee(9));

        // Mint more
        await web3tx(token.approve, "token.approve 2 by customer2")(rToken.address, toWad(2), {
            from: customer2
        });
        await web3tx(rToken.mint, "rToken.mint 2 to customer2")(toWad(2), {
            from: customer2
        });

        assert.equal(wad4human(await rToken.getRewardsOwed.call(customer1)), parseRemainderAfterFee(9));
        assert.equal(wad4human(await rToken.getRewardsOwed.call(customer2)), parseRemainderAfterFee(1));

        await web3tx(rewardToken.mint, "rewardToken.mint 10 -> compoundAS")(compoundAS.address, toWad(10), {
            from: admin
        });
        assert.equal(wad4human(await rewardToken.balanceOf.call(compoundAS.address)), "10.00000");
        await web3tx(rToken.collectRewards, "rToken.collectedRewards 10 from compoundAS")({
            from: admin
        });
        assert.equal(wad4human(await rewardToken.balanceOf.call(rToken.address)), "20.00000");
        console.log("customer1 rewards: ", wad4human(await rToken.getRewardsOwed.call(customer1)));
        console.log("customer2 rewards: ", wad4human(await rToken.getRewardsOwed.call(customer2)));
        assert.equal(wad4human(web3.utils.toBN(await rToken.getRewardsOwed.call(customer1))
            .add(await rToken.getRewardsOwed.call(customer2))), parseRemainderAfterFee(20));

        // transfer 10 from customer 1 to customer 3
        await web3tx(rToken.transfer, "rToken.transfer 10 from customer1 to customer3")(customer3, toWad(10), {
            from: customer1
        });
        await web3tx(rToken.changeHat, "rToken.changeHat for customer3")(0, {
            from: customer3
        });
        await doBingeBorrowing();
        await expectAccount(customer1, {
            tokenBalance: "78.00111",
            cumulativeInterest: "0.00111",
            receivedLoan: "70.20000",
            receivedSavings: "70.20268",
            interestPayable: "0.00158",
        });
        await expectAccount(customer2, {
            tokenBalance: "2.00012",
            cumulativeInterest: "0.00012",
            receivedLoan: "9.80000",
            receivedSavings: "9.80034",
            interestPayable: "0.00022",
        });
        await expectAccount(customer3, {
            tokenBalance: "10.00000",
            cumulativeInterest: "0.00000",
            receivedLoan: "10.00000",
            receivedSavings: "10.00022",
            interestPayable: "0.00022",
        });

        console.log("customer1 rewards: ", wad4human(await rToken.getRewardsOwed.call(customer1)));
        console.log("customer2 rewards: ", wad4human(await rToken.getRewardsOwed.call(customer2)));
        console.log("customer3 rewards: ", wad4human(await rToken.getRewardsOwed.call(customer3)));

        // Distribute reward token
        await web3tx(rewardToken.mint, "rewardToken.mint 10 -> compoundAS")(compoundAS.address, toWad(10), {
            from: admin
        });
        assert.equal(wad4human(await rewardToken.balanceOf.call(compoundAS.address)), "10.00000");
        await web3tx(rToken.collectRewards, "rToken.collectedRewards 10 from compoundAS")({
            from: admin
        });
        assert.equal(wad4human(await rewardToken.balanceOf.call(rToken.address)), "30.00000");

        console.log("customer1 rewards: ", wad4human(await rToken.getRewardsOwed.call(customer1)));
        console.log("customer2 rewards: ", wad4human(await rToken.getRewardsOwed.call(customer2)));
        console.log("customer3 rewards: ", wad4human(await rToken.getRewardsOwed.call(customer3)));
        assert.equal(wad4human(web3.utils.toBN(
            await rToken.getRewardsOwed.call(customer1))
            .add(await rToken.getRewardsOwed.call(customer2))
            .add(await rToken.getRewardsOwed.call(customer3))), parseRemainderAfterFee(30));

        await doWithdrawReward("customer1", customer1, rewardToken);

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
            tokenBalance: "83.00275",
            cumulativeInterest: "0.00275",
            receivedLoan: "74.70000",
            receivedSavings: "74.70275",
            interestPayable: "0.00000",
        });
        await expectAccount(customer2, {
            tokenBalance: "2.00012",
            cumulativeInterest: "0.00012",
            receivedLoan: "10.30000",
            receivedSavings: "10.30035",
            interestPayable: "0.00023",
        });
        await expectAccount(customer3, {
            tokenBalance: "5.00023",
            cumulativeInterest: "0.00023",
            receivedLoan: "5.00000",
            receivedSavings: "5.00023",
            interestPayable: "0.00000",
        });

        console.log("customer2 rewards: ", wad4human(await rToken.getRewardsOwed.call(customer2)));
        console.log("customer3 rewards: ", wad4human(await rToken.getRewardsOwed.call(customer3)));
        const customer2RewardsOwed = await rToken.getRewardsOwed.call(customer2);
        const customer3RewardsOwed = await rToken.getRewardsOwed.call(customer3);

        // Final transfer of rewards token without collecting
        await web3tx(rewardToken.mint, "rewardToken.mint 10 -> compoundAS")(compoundAS.address, toWad(10), {
            from: admin
        });

        assert.equal(wad4human(await rToken.getRewardsOwed.call(customer2)), wad4human(customer2RewardsOwed));
        assert.equal(wad4human(await rToken.getRewardsOwed.call(customer3)), wad4human(customer3RewardsOwed));

        // Change the rewards token

        const newRewardToken = await web3tx(ERC20Mintable.new, "ERC20Mintable.new")({ from: admin });
        await web3tx(newRewardToken.mint, "newRewardToken.mint 100 -> compoundAS")(compoundAS.address, toWad(100), { from: admin });
        await web3tx(rToken.setRewardsToken, "rToken.setRewardsToken as newRewardToken")(newRewardToken.address, {
            from: admin
        });
        await web3tx(rToken.collectRewards, "rToken.collectedRewards 10 from compoundAS")({
            from: admin
        });
        assert.equal(wad4human(await rewardToken.balanceOf.call(admin)), "4.00000");

        // After switching token, new rewards are displayed
        console.log("customer1 rewards: ", wad4human(await rToken.getRewardsOwed.call(customer1)));
        console.log("customer2 rewards: ", wad4human(await rToken.getRewardsOwed.call(customer2)));
        console.log("customer3 rewards: ", wad4human(await rToken.getRewardsOwed.call(customer3)));

        // Get past rewards
        console.log("customer1 past rewards: ", wad4human(await rToken.getPastRewardsOwed.call(customer1, rewardToken.address)));
        console.log("customer2 past rewards: ", wad4human(await rToken.getPastRewardsOwed.call(customer2, rewardToken.address)));
        console.log("customer3 past rewards: ", wad4human(await rToken.getPastRewardsOwed.call(customer3, rewardToken.address)));

        const totalPastRewards = wad4human(
            web3.utils.toBN(toWad(parseRemainderAfterFee(10)))
                .add(customer2RewardsOwed)
                .add(customer3RewardsOwed)
        );
        assert.equal(wad4human(
            web3.utils.toBN(
                await rToken.getPastRewardsOwed.call(customer1, rewardToken.address))
                .add(await rToken.getPastRewardsOwed.call(customer2, rewardToken.address))
                .add(await rToken.getPastRewardsOwed.call(customer3, rewardToken.address))
        ), totalPastRewards);

        // Withdraw past rewards
        await doPastWithdrawReward("customer1", customer1, rewardToken);

        // Transfer rToken
        await web3tx(rToken.transfer, "rToken.transfer 2 from customer2 to customer3", {
            inLogs: [{
                name: "Transfer",
                args: {
                    from: customer2,
                    to: customer3,
                    value: toWad(2)
                }
            }]
        })(customer3, toWad(2), { from: customer2 });

        // Withdraw past rewards
        await expectRevert(rToken.withdrawPastRewards(newRewardToken.address, { from: customer2 }), "Cannnot get past rewards on current rewards token");
        await doPastWithdrawReward("customer2", customer2, rewardToken);
    });

    it("#2 normal operations with interest fees", async () => {
        await web3tx(rToken.setInterestFee, "rToken.setInterestFee")(toWad(0.1), {
            from: admin
        });
        await web3tx(token.approve, "token.approve 100 by customer1")(rToken.address, toWad(100), {
            from: customer1
        });
        await web3tx(rToken.mint, "rToken.mint 100 to customer1")(toWad(100), { from: customer1 });
        assert.equal(wad4human(await token.balanceOf.call(customer1)), "900.00000");
        await expectAccount(customer1, {
            tokenBalance: "100.00000",
            cumulativeInterest: "0.00000",
            receivedLoan: "90.00000",
            receivedSavings: "90.00000",
            interestPayable: "0.00000",
        });
        await expectAccount(admin, {
            tokenBalance: "0.00000",
            cumulativeInterest: "0.00000",
            receivedLoan: "10.00000",
            receivedSavings: "10.00000",
            interestPayable: "0.00000",
        });
        await doBingeBorrowing();
        await expectAccount(customer1, {
            tokenBalance: "100.00000",
            cumulativeInterest: "0.00000",
            receivedLoan: "90.00000",
            receivedSavings: "90.00090",
            interestPayable: "0.00090",
        });
        await expectAccount(admin, {
            tokenBalance: "0.00000",
            cumulativeInterest: "0.00000",
            receivedLoan: "10.00000",
            receivedSavings: "10.00010",
            interestPayable: "0.00010",
        });
        await web3tx(rToken.redeem, "rToken.redeem 90 to customer1")(toWad(90), { from: customer1 });
        assert.equal(wad4human(await token.balanceOf.call(customer1)), "990.00000");
        await expectAccount(customer1, {
            tokenBalance: "10.00091",
            cumulativeInterest: "0.00091",
            receivedLoan: "9.00000",
            receivedSavings: "9.00091",
            interestPayable: "0.00000",
        });
        await expectAccount(admin, {
            tokenBalance: "0.00000",
            cumulativeInterest: "0.00000",
            receivedLoan: "1.00000",
            receivedSavings: "1.00010",
            interestPayable: "0.00010",
        });

        await web3tx(rToken.createHat, "rToken.createHat benefiting customer1(90%) and customer2(10%)")(
            [customer1, customer2], [90, 10], true, { from: customer1 });

        await expectAccount(customer1, {
            tokenBalance: "10.00091",
            cumulativeInterest: "0.00091",
            receivedLoan: "8.10074", //10.00086
            receivedSavings: "9.00091",
            interestPayable: "0.90008",
        });
        await expectAccount(customer2, {
            tokenBalance: "0.00000",
            cumulativeInterest: "0.00000",
            receivedLoan: "0.90008",
            receivedSavings: "0.00000",
            interestPayable: "0.00000",
        });
        await expectAccount(admin, {
            tokenBalance: "0.00000",
            cumulativeInterest: "0.00000",
            receivedLoan: "1.00009",
            receivedSavings: "1.00020",
            interestPayable: "0.00011",
        });

        await waitForInterest();

        await expectAccount(customer1, {
            tokenBalance: "10.00091",
            cumulativeInterest: "0.00091",
            receivedLoan: "8.10074", //10.00086
            receivedSavings: "9.00991",
            interestPayable: "0.90908",
        });
        await expectAccount(customer2, {
            tokenBalance: "0.00000",
            cumulativeInterest: "0.00000",
            receivedLoan: "0.90008",
            receivedSavings: "0.00000",
            interestPayable: "0.00000",
        });
        await expectAccount(admin, {
            tokenBalance: "0.00000",
            cumulativeInterest: "0.00000",
            receivedLoan: "1.00009",
            receivedSavings: "1.00120",
            interestPayable: "0.00111",
        });

    });

    it("#3 normal operations without interest fees", async () => {
        await web3tx(token.approve, "token.approve 100 by customer1")(rToken.address, toWad(100), {
            from: customer1
        });
        await web3tx(rToken.mint, "rToken.mint 100 to customer1")(toWad(100), { from: customer1 });
        assert.equal(wad4human(await token.balanceOf.call(customer1)), "900.00000");
        await expectAccount(customer1, {
            tokenBalance: "100.00000",
            cumulativeInterest: "0.00000",
            receivedLoan: "100.00000",
            receivedSavings: "100.00000",
            interestPayable: "0.00000",
        });
        await expectAccount(admin, {
            tokenBalance: "0.00000",
            cumulativeInterest: "0.00000",
            receivedLoan: "0.00000",
            receivedSavings: "0.00000",
            interestPayable: "0.00000",
        });
        await doBingeBorrowing();
        await expectAccount(customer1, {
            tokenBalance: "100.00000",
            cumulativeInterest: "0.00000",
            receivedLoan: "100.00000",
            receivedSavings: "100.00100",
            interestPayable: "0.00100",
        });
        await expectAccount(admin, {
            tokenBalance: "0.00000",
            cumulativeInterest: "0.00000",
            receivedLoan: "0.00000",
            receivedSavings: "0.00000",
            interestPayable: "0.00000",
        });
        await web3tx(rToken.redeem, "rToken.redeem 90 to customer1")(toWad(90), { from: customer1 });
        assert.equal(wad4human(await token.balanceOf.call(customer1)), "990.00000");
        await expectAccount(customer1, {
            tokenBalance: "10.00101",
            cumulativeInterest: "0.00101",
            receivedLoan: "10.00000",
            receivedSavings: "10.00101",
            interestPayable: "0.00000",
        });
        await expectAccount(admin, {
            tokenBalance: "0.00000",
            cumulativeInterest: "0.00000",
            receivedLoan: "0.00000",
            receivedSavings: "0.00000",
            interestPayable: "0.00000",
        });

        await web3tx(rToken.createHat, "rToken.createHat benefiting customer1(90%) and customer2(10%)")(
            [customer1, customer2], [90, 10], true, { from: customer1 });

        await expectAccount(customer1, {
            tokenBalance: "10.00101",
            cumulativeInterest: "0.00086",
            receivedLoan: "10.00111", //10.00086
            receivedSavings: "10.00111",
            interestPayable: "0.00000",
        });

        await expectAccount(customer2, {
            tokenBalance: "0.00000",
            cumulativeInterest: "0.00000",
            receivedLoan: "1.00010",
            receivedSavings: "1.00010",
            interestPayable: "0.00000",
        });

        await expectAccount(admin, {
            tokenBalance: "0.00000",
            cumulativeInterest: "0.00000",
            receivedLoan: "0.00000",
            receivedSavings: "0.00000",
            interestPayable: "0.00000",
        });

        await waitForInterest();

        await expectAccount(customer1, {
            tokenBalance: "10.00091",
            cumulativeInterest: "0.00091",
            receivedLoan: "9.00086",
            receivedSavings: "10.01111",
            interestPayable: "0.91019",
        });
        await expectAccount(customer2, {
            tokenBalance: "0.00000",
            cumulativeInterest: "0.00000",
            receivedLoan: "1.00009",
            receivedSavings: "0.00000",
            interestPayable: "0.00000",
        });
        await expectAccount(admin, {
            tokenBalance: "0.00000",
            cumulativeInterest: "0.00000",
            receivedLoan: "0.00000",
            receivedSavings: "0.00000",
            interestPayable: "0.00000",
        });
    });
});
