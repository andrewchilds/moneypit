#!/usr/bin/env npx tsx
/**
 * Demo Data Seed Script
 *
 * Creates a Demo book with realistic sample data for exploring Moneypit.
 * Run with: npx tsx scripts/seed-demo.ts
 * Or via CLI: bin/mp demo:create
 */

import { db } from "../src/lib/server/db";
import { AccountType, TransactionStatus } from "@prisma/client";
import { DEFAULT_TAX_CATEGORIES } from "../src/lib/server/constants/taxCategories";

const DEMO_ACCOUNTS = [
	// Assets
	{ type: AccountType.ASSET, path: "Checking", last4: "4521" },
	{ type: AccountType.ASSET, path: "Savings", last4: "8734" },
	{ type: AccountType.ASSET, path: "Cash" },
	{ type: AccountType.ASSET, path: "Venmo", last4: "1234" },

	// Liabilities
	{ type: AccountType.LIABILITY, path: "Credit Card:Chase Freedom", last4: "9012" },
	{ type: AccountType.LIABILITY, path: "Credit Card:Capital One Venture", last4: "5678" },
	{ type: AccountType.LIABILITY, path: "Credit Card:Amex Gold", last4: "3456" },

	// Income
	{ type: AccountType.INCOME, path: "Salary" },
	{ type: AccountType.INCOME, path: "Freelance" },
	{ type: AccountType.INCOME, path: "Interest" },
	{ type: AccountType.INCOME, path: "Dividends" },
	{ type: AccountType.INCOME, path: "Reimbursements" },

	// Expenses - Housing
	{ type: AccountType.EXPENSE, path: "Housing:Rent" },
	{ type: AccountType.EXPENSE, path: "Housing:Utilities:Electric" },
	{ type: AccountType.EXPENSE, path: "Housing:Utilities:Gas" },
	{ type: AccountType.EXPENSE, path: "Housing:Utilities:Water" },
	{ type: AccountType.EXPENSE, path: "Housing:Utilities:Internet" },
	{ type: AccountType.EXPENSE, path: "Housing:Renters Insurance" },
	{ type: AccountType.EXPENSE, path: "Housing:Furniture" },

	// Expenses - Food
	{ type: AccountType.EXPENSE, path: "Food:Groceries" },
	{ type: AccountType.EXPENSE, path: "Food:Restaurants" },
	{ type: AccountType.EXPENSE, path: "Food:Coffee" },
	{ type: AccountType.EXPENSE, path: "Food:Takeout" },
	{ type: AccountType.EXPENSE, path: "Food:Alcohol" },

	// Expenses - Transportation
	{ type: AccountType.EXPENSE, path: "Transportation:Gas" },
	{ type: AccountType.EXPENSE, path: "Transportation:Insurance" },
	{ type: AccountType.EXPENSE, path: "Transportation:Maintenance" },
	{ type: AccountType.EXPENSE, path: "Transportation:Parking" },
	{ type: AccountType.EXPENSE, path: "Transportation:Tolls" },
	{ type: AccountType.EXPENSE, path: "Transportation:Rideshare" },
	{ type: AccountType.EXPENSE, path: "Transportation:Public Transit" },

	// Expenses - Entertainment
	{ type: AccountType.EXPENSE, path: "Entertainment:Streaming" },
	{ type: AccountType.EXPENSE, path: "Entertainment:Movies" },
	{ type: AccountType.EXPENSE, path: "Entertainment:Concerts" },
	{ type: AccountType.EXPENSE, path: "Entertainment:Games" },
	{ type: AccountType.EXPENSE, path: "Entertainment:Books" },

	// Expenses - Shopping
	{ type: AccountType.EXPENSE, path: "Shopping:Clothing" },
	{ type: AccountType.EXPENSE, path: "Shopping:Electronics" },
	{ type: AccountType.EXPENSE, path: "Shopping:Home Goods" },
	{ type: AccountType.EXPENSE, path: "Shopping:Gifts" },

	// Expenses - Health
	{ type: AccountType.EXPENSE, path: "Health:Gym" },
	{ type: AccountType.EXPENSE, path: "Health:Pharmacy" },
	{ type: AccountType.EXPENSE, path: "Health:Doctor" },
	{ type: AccountType.EXPENSE, path: "Health:Dental" },
	{ type: AccountType.EXPENSE, path: "Health:Vision" },

	// Expenses - Personal
	{ type: AccountType.EXPENSE, path: "Personal:Haircut" },
	{ type: AccountType.EXPENSE, path: "Personal:Subscriptions" },
	{ type: AccountType.EXPENSE, path: "Personal:Education" },

	// Expenses - Travel
	{ type: AccountType.EXPENSE, path: "Travel:Flights" },
	{ type: AccountType.EXPENSE, path: "Travel:Hotels" },
	{ type: AccountType.EXPENSE, path: "Travel:Car Rental" },

	// Expenses - Pets
	{ type: AccountType.EXPENSE, path: "Pets:Food" },
	{ type: AccountType.EXPENSE, path: "Pets:Vet" },
	{ type: AccountType.EXPENSE, path: "Pets:Supplies" },

	// Equity
	{ type: AccountType.EQUITY, path: "Opening Balances" }
];

const MERCHANTS = {
	groceries: [
		"Whole Foods Market",
		"Trader Joe's",
		"Safeway",
		"Costco Wholesale",
		"Target",
		"Walmart Supercenter",
		"Kroger",
		"Aldi",
		"Publix",
		"H-E-B",
		"Sprouts Farmers Market",
		"Fresh Market"
	],
	restaurants: [
		"Chipotle Mexican Grill",
		"Panera Bread",
		"Olive Garden",
		"Thai Kitchen",
		"Sakura Sushi",
		"Applebee's",
		"Chilis",
		"Buffalo Wild Wings",
		"Red Lobster",
		"Outback Steakhouse",
		"Cheesecake Factory",
		"PF Changs",
		"Five Guys",
		"Shake Shack",
		"In-N-Out Burger"
	],
	coffee: [
		"Starbucks",
		"Blue Bottle Coffee",
		"Local Cafe",
		"Peet's Coffee",
		"Dunkin",
		"Dutch Bros",
		"Philz Coffee",
		"Coffee Bean & Tea Leaf"
	],
	takeout: ["DoorDash", "Uber Eats", "Grubhub", "Postmates", "Instacart", "Seamless"],
	gas: ["Shell", "Chevron", "76 Station", "Costco Gas", "Exxon", "Mobil", "BP", "Speedway"],
	streaming: [
		"Netflix",
		"Spotify Premium",
		"HBO Max",
		"Disney+",
		"Hulu",
		"Apple TV+",
		"Amazon Prime Video",
		"YouTube Premium",
		"Peacock Premium"
	],
	utilities: ["PG&E", "City Water", "Comcast Xfinity", "AT&T", "Verizon", "National Grid"],
	rideshare: ["Uber", "Lyft"],
	clothing: ["Nordstrom", "Macys", "Gap", "Old Navy", "Uniqlo", "H&M", "Zara", "Nike", "Adidas", "REI"],
	electronics: ["Apple Store", "Best Buy", "Amazon", "B&H Photo", "Micro Center", "Newegg"],
	pharmacy: ["CVS Pharmacy", "Walgreens", "Rite Aid", "Amazon Pharmacy"],
	homegoods: ["IKEA", "Bed Bath Beyond", "Home Depot", "Lowes", "Williams Sonoma", "Crate & Barrel"],
	books: ["Amazon Books", "Barnes & Noble", "Audible", "Kindle Store"],
	pets: ["Petco", "PetSmart", "Chewy", "VCA Animal Hospital"],
	gym: ["Planet Fitness", "Equinox", "24 Hour Fitness", "LA Fitness", "CrossFit Box"],
	haircut: ["Great Clips", "Supercuts", "Sports Clips", "Local Barber"],
	parking: ["SpotHero", "ParkMobile", "City Parking", "Airport Parking"],
	alcohol: ["Total Wine", "BevMo", "Liquor Store", "Wine.com"],
	games: ["Steam", "PlayStation Store", "Xbox Store", "Nintendo eShop", "Epic Games"],
	travel: [
		"United Airlines",
		"Delta Airlines",
		"American Airlines",
		"Southwest Airlines",
		"Marriott Hotels",
		"Hilton Hotels",
		"Airbnb",
		"VRBO",
		"Hertz",
		"Enterprise",
		"National Car Rental"
	]
};

// Uncategorized merchant names - these should look like real bank descriptions
const UNCATEGORIZED_MERCHANTS = [
	"SQ *COFFEE SHOP",
	"TST* RESTAURANT NYC",
	"VENMO PAYMENT",
	"ZELLE TRANSFER",
	"PAYPAL *MERCHANT",
	"POS PURCHASE 1234",
	"CHECKCARD 0419 STORE",
	"DEBIT CARD PURCHASE",
	"ACH DEBIT COMPANY",
	"RECURRING PAYMENT",
	"ONLINE PURCHASE",
	"MOBILE PAYMENT",
	"WIRE TRANSFER FEE",
	"ATM WITHDRAWAL",
	"SQ *UNKNOWN VENDOR",
	"PP*DIGITALSERVICE",
	"GOOGLE *SERVICES",
	"APPLE.COM/BILL",
	"AMZN MKTP US",
	"PRIME VIDEO",
	"MICROSOFT *STORE",
	"SP * SHOPNAME",
	"STRIPE PAYMENT",
	"WPY*VENDOR NAME",
	"CKE*RESTAURANT",
	"TST*FOOD PLACE",
	"SQU*SQ *BUSINESS",
	"DOORDASH DASHER",
	"UBER TRIP",
	"LYFT RIDE",
	"PARKING METER 42",
	"TOLL ROAD FEE",
	"GAS STATION 789",
	"GROCERY STORE 456",
	"HARDWARE STORE",
	"AUTO PARTS STORE",
	"MEDICAL OFFICE",
	"DENTAL PAYMENT",
	"INSURANCE PREMIUM",
	"SUBSCRIPTION SVC"
];

function randomAmount(min: number, max: number): number {
	return Math.round((Math.random() * (max - min) + min) * 100) / 100;
}

function randomItem<T>(arr: T[]): T {
	return arr[Math.floor(Math.random() * arr.length)];
}

function randomDay(month: Date): number {
	const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
	return Math.floor(Math.random() * daysInMonth) + 1;
}

function randomCreditCard(accountMap: Map<string, string>): string {
	const cards = ["Credit Card:Chase Freedom", "Credit Card:Capital One Venture", "Credit Card:Amex Gold"];
	return accountMap.get(randomItem(cards))!;
}

interface GeneratedTransaction {
	date: Date;
	description: string;
	amount: number;
	debitAccountId: string | null;
	creditAccountId: string | null;
	status: TransactionStatus;
	importSource?: string;
}

function generateTransactions(accountMap: Map<string, string>, months: number): GeneratedTransaction[] {
	const transactions: GeneratedTransaction[] = [];
	const now = new Date();

	for (let m = 0; m < months; m++) {
		const monthDate = new Date(now.getFullYear(), now.getMonth() - m, 1);
		const isCurrentMonth = m === 0;
		const isRecentMonth = m < 3;

		// Salary (twice a month)
		transactions.push({
			date: new Date(monthDate.getFullYear(), monthDate.getMonth(), 1),
			description: "Direct Deposit - Employer Inc",
			amount: 4500,
			debitAccountId: accountMap.get("Checking")!,
			creditAccountId: accountMap.get("Salary")!,
			status: TransactionStatus.CATEGORIZED
		});
		transactions.push({
			date: new Date(monthDate.getFullYear(), monthDate.getMonth(), 15),
			description: "Direct Deposit - Employer Inc",
			amount: 4500,
			debitAccountId: accountMap.get("Checking")!,
			creditAccountId: accountMap.get("Salary")!,
			status: TransactionStatus.CATEGORIZED
		});

		// Rent
		transactions.push({
			date: new Date(monthDate.getFullYear(), monthDate.getMonth(), 1),
			description: "Rent Payment - Acme Properties",
			amount: 2200,
			debitAccountId: accountMap.get("Housing:Rent")!,
			creditAccountId: accountMap.get("Checking")!,
			status: TransactionStatus.CATEGORIZED
		});

		// Utilities
		transactions.push({
			date: new Date(monthDate.getFullYear(), monthDate.getMonth(), 5),
			description: randomItem(MERCHANTS.utilities) + " Electric",
			amount: randomAmount(80, 180),
			debitAccountId: accountMap.get("Housing:Utilities:Electric")!,
			creditAccountId: accountMap.get("Checking")!,
			status: TransactionStatus.CATEGORIZED
		});

		transactions.push({
			date: new Date(monthDate.getFullYear(), monthDate.getMonth(), 8),
			description: "Gas Company Monthly",
			amount: randomAmount(30, 100),
			debitAccountId: accountMap.get("Housing:Utilities:Gas")!,
			creditAccountId: accountMap.get("Checking")!,
			status: TransactionStatus.CATEGORIZED
		});

		transactions.push({
			date: new Date(monthDate.getFullYear(), monthDate.getMonth(), 10),
			description: "City Water Utility",
			amount: randomAmount(40, 70),
			debitAccountId: accountMap.get("Housing:Utilities:Water")!,
			creditAccountId: accountMap.get("Checking")!,
			status: TransactionStatus.CATEGORIZED
		});

		transactions.push({
			date: new Date(monthDate.getFullYear(), monthDate.getMonth(), 12),
			description: "Comcast Xfinity Internet",
			amount: 79.99,
			debitAccountId: accountMap.get("Housing:Utilities:Internet")!,
			creditAccountId: accountMap.get("Checking")!,
			status: TransactionStatus.CATEGORIZED
		});

		// Groceries (6-10 per month, split across cards)
		for (let i = 0; i < Math.floor(Math.random() * 5) + 6; i++) {
			transactions.push({
				date: new Date(monthDate.getFullYear(), monthDate.getMonth(), randomDay(monthDate)),
				description: randomItem(MERCHANTS.groceries),
				amount: randomAmount(40, 250),
				debitAccountId: accountMap.get("Food:Groceries")!,
				creditAccountId: randomCreditCard(accountMap),
				status: TransactionStatus.CATEGORIZED
			});
		}

		// Restaurants (4-8 per month)
		for (let i = 0; i < Math.floor(Math.random() * 5) + 4; i++) {
			transactions.push({
				date: new Date(monthDate.getFullYear(), monthDate.getMonth(), randomDay(monthDate)),
				description: randomItem(MERCHANTS.restaurants),
				amount: randomAmount(15, 80),
				debitAccountId: accountMap.get("Food:Restaurants")!,
				creditAccountId: randomCreditCard(accountMap),
				status: TransactionStatus.CATEGORIZED
			});
		}

		// Coffee (8-15 per month)
		for (let i = 0; i < Math.floor(Math.random() * 8) + 8; i++) {
			transactions.push({
				date: new Date(monthDate.getFullYear(), monthDate.getMonth(), randomDay(monthDate)),
				description: randomItem(MERCHANTS.coffee),
				amount: randomAmount(4, 12),
				debitAccountId: accountMap.get("Food:Coffee")!,
				creditAccountId: randomCreditCard(accountMap),
				status: TransactionStatus.CATEGORIZED
			});
		}

		// Takeout/Delivery (3-6 per month)
		for (let i = 0; i < Math.floor(Math.random() * 4) + 3; i++) {
			transactions.push({
				date: new Date(monthDate.getFullYear(), monthDate.getMonth(), randomDay(monthDate)),
				description: randomItem(MERCHANTS.takeout),
				amount: randomAmount(20, 60),
				debitAccountId: accountMap.get("Food:Takeout")!,
				creditAccountId: randomCreditCard(accountMap),
				status: TransactionStatus.CATEGORIZED
			});
		}

		// Alcohol (1-3 per month)
		for (let i = 0; i < Math.floor(Math.random() * 3) + 1; i++) {
			transactions.push({
				date: new Date(monthDate.getFullYear(), monthDate.getMonth(), randomDay(monthDate)),
				description: randomItem(MERCHANTS.alcohol),
				amount: randomAmount(15, 80),
				debitAccountId: accountMap.get("Food:Alcohol")!,
				creditAccountId: randomCreditCard(accountMap),
				status: TransactionStatus.CATEGORIZED
			});
		}

		// Gas (3-5 per month)
		for (let i = 0; i < Math.floor(Math.random() * 3) + 3; i++) {
			transactions.push({
				date: new Date(monthDate.getFullYear(), monthDate.getMonth(), randomDay(monthDate)),
				description: randomItem(MERCHANTS.gas),
				amount: randomAmount(35, 75),
				debitAccountId: accountMap.get("Transportation:Gas")!,
				creditAccountId: randomCreditCard(accountMap),
				status: TransactionStatus.CATEGORIZED
			});
		}

		// Rideshare (2-5 per month)
		for (let i = 0; i < Math.floor(Math.random() * 4) + 2; i++) {
			transactions.push({
				date: new Date(monthDate.getFullYear(), monthDate.getMonth(), randomDay(monthDate)),
				description: randomItem(MERCHANTS.rideshare),
				amount: randomAmount(12, 45),
				debitAccountId: accountMap.get("Transportation:Rideshare")!,
				creditAccountId: randomCreditCard(accountMap),
				status: TransactionStatus.CATEGORIZED
			});
		}

		// Parking (1-3 per month)
		for (let i = 0; i < Math.floor(Math.random() * 3) + 1; i++) {
			transactions.push({
				date: new Date(monthDate.getFullYear(), monthDate.getMonth(), randomDay(monthDate)),
				description: randomItem(MERCHANTS.parking),
				amount: randomAmount(5, 25),
				debitAccountId: accountMap.get("Transportation:Parking")!,
				creditAccountId: randomCreditCard(accountMap),
				status: TransactionStatus.CATEGORIZED
			});
		}

		// Car insurance (once a month)
		transactions.push({
			date: new Date(monthDate.getFullYear(), monthDate.getMonth(), 15),
			description: "GEICO Auto Insurance",
			amount: 125,
			debitAccountId: accountMap.get("Transportation:Insurance")!,
			creditAccountId: accountMap.get("Checking")!,
			status: TransactionStatus.CATEGORIZED
		});

		// Streaming services (fixed monthly)
		const streamingDay = 10;
		transactions.push({
			date: new Date(monthDate.getFullYear(), monthDate.getMonth(), streamingDay),
			description: "Netflix",
			amount: 15.99,
			debitAccountId: accountMap.get("Entertainment:Streaming")!,
			creditAccountId: accountMap.get("Credit Card:Chase Freedom")!,
			status: TransactionStatus.CATEGORIZED
		});
		transactions.push({
			date: new Date(monthDate.getFullYear(), monthDate.getMonth(), streamingDay + 2),
			description: "Spotify Premium",
			amount: 10.99,
			debitAccountId: accountMap.get("Entertainment:Streaming")!,
			creditAccountId: accountMap.get("Credit Card:Chase Freedom")!,
			status: TransactionStatus.CATEGORIZED
		});
		transactions.push({
			date: new Date(monthDate.getFullYear(), monthDate.getMonth(), streamingDay + 4),
			description: "HBO Max",
			amount: 15.99,
			debitAccountId: accountMap.get("Entertainment:Streaming")!,
			creditAccountId: accountMap.get("Credit Card:Chase Freedom")!,
			status: TransactionStatus.CATEGORIZED
		});

		// Books/Audible (1-2 per month)
		for (let i = 0; i < Math.floor(Math.random() * 2) + 1; i++) {
			transactions.push({
				date: new Date(monthDate.getFullYear(), monthDate.getMonth(), randomDay(monthDate)),
				description: randomItem(MERCHANTS.books),
				amount: randomAmount(10, 30),
				debitAccountId: accountMap.get("Entertainment:Books")!,
				creditAccountId: randomCreditCard(accountMap),
				status: TransactionStatus.CATEGORIZED
			});
		}

		// Games (0-2 per month)
		for (let i = 0; i < Math.floor(Math.random() * 3); i++) {
			transactions.push({
				date: new Date(monthDate.getFullYear(), monthDate.getMonth(), randomDay(monthDate)),
				description: randomItem(MERCHANTS.games),
				amount: randomAmount(10, 70),
				debitAccountId: accountMap.get("Entertainment:Games")!,
				creditAccountId: randomCreditCard(accountMap),
				status: TransactionStatus.CATEGORIZED
			});
		}

		// Gym membership
		transactions.push({
			date: new Date(monthDate.getFullYear(), monthDate.getMonth(), 1),
			description: randomItem(MERCHANTS.gym),
			amount: 29.99,
			debitAccountId: accountMap.get("Health:Gym")!,
			creditAccountId: accountMap.get("Credit Card:Amex Gold")!,
			status: TransactionStatus.CATEGORIZED
		});

		// Pharmacy (1-3 per month)
		for (let i = 0; i < Math.floor(Math.random() * 3) + 1; i++) {
			transactions.push({
				date: new Date(monthDate.getFullYear(), monthDate.getMonth(), randomDay(monthDate)),
				description: randomItem(MERCHANTS.pharmacy),
				amount: randomAmount(10, 60),
				debitAccountId: accountMap.get("Health:Pharmacy")!,
				creditAccountId: randomCreditCard(accountMap),
				status: TransactionStatus.CATEGORIZED
			});
		}

		// Haircut (once every 1-2 months)
		if (m % 2 === 0) {
			transactions.push({
				date: new Date(monthDate.getFullYear(), monthDate.getMonth(), randomDay(monthDate)),
				description: randomItem(MERCHANTS.haircut),
				amount: randomAmount(25, 50),
				debitAccountId: accountMap.get("Personal:Haircut")!,
				creditAccountId: randomCreditCard(accountMap),
				status: TransactionStatus.CATEGORIZED
			});
		}

		// Clothing (0-3 per month)
		for (let i = 0; i < Math.floor(Math.random() * 4); i++) {
			transactions.push({
				date: new Date(monthDate.getFullYear(), monthDate.getMonth(), randomDay(monthDate)),
				description: randomItem(MERCHANTS.clothing),
				amount: randomAmount(30, 150),
				debitAccountId: accountMap.get("Shopping:Clothing")!,
				creditAccountId: randomCreditCard(accountMap),
				status: TransactionStatus.CATEGORIZED
			});
		}

		// Electronics (0-1 per month)
		if (Math.random() > 0.6) {
			transactions.push({
				date: new Date(monthDate.getFullYear(), monthDate.getMonth(), randomDay(monthDate)),
				description: randomItem(MERCHANTS.electronics),
				amount: randomAmount(50, 500),
				debitAccountId: accountMap.get("Shopping:Electronics")!,
				creditAccountId: randomCreditCard(accountMap),
				status: TransactionStatus.CATEGORIZED
			});
		}

		// Home goods (0-2 per month)
		for (let i = 0; i < Math.floor(Math.random() * 3); i++) {
			transactions.push({
				date: new Date(monthDate.getFullYear(), monthDate.getMonth(), randomDay(monthDate)),
				description: randomItem(MERCHANTS.homegoods),
				amount: randomAmount(20, 200),
				debitAccountId: accountMap.get("Shopping:Home Goods")!,
				creditAccountId: randomCreditCard(accountMap),
				status: TransactionStatus.CATEGORIZED
			});
		}

		// Pet expenses (2-4 per month)
		for (let i = 0; i < Math.floor(Math.random() * 3) + 2; i++) {
			transactions.push({
				date: new Date(monthDate.getFullYear(), monthDate.getMonth(), randomDay(monthDate)),
				description: randomItem(MERCHANTS.pets),
				amount: randomAmount(15, 80),
				debitAccountId: accountMap.get("Pets:Food")!,
				creditAccountId: randomCreditCard(accountMap),
				status: TransactionStatus.CATEGORIZED
			});
		}

		// Vet visit (once every 3-4 months)
		if (m % 4 === 0) {
			transactions.push({
				date: new Date(monthDate.getFullYear(), monthDate.getMonth(), randomDay(monthDate)),
				description: "VCA Animal Hospital",
				amount: randomAmount(100, 400),
				debitAccountId: accountMap.get("Pets:Vet")!,
				creditAccountId: randomCreditCard(accountMap),
				status: TransactionStatus.CATEGORIZED
			});
		}

		// Credit card payments (from checking to each card)
		transactions.push({
			date: new Date(monthDate.getFullYear(), monthDate.getMonth(), 20),
			description: "Chase Freedom Payment",
			amount: randomAmount(800, 1500),
			debitAccountId: accountMap.get("Credit Card:Chase Freedom")!,
			creditAccountId: accountMap.get("Checking")!,
			status: TransactionStatus.CATEGORIZED
		});

		transactions.push({
			date: new Date(monthDate.getFullYear(), monthDate.getMonth(), 21),
			description: "Capital One Venture Payment",
			amount: randomAmount(600, 1200),
			debitAccountId: accountMap.get("Credit Card:Capital One Venture")!,
			creditAccountId: accountMap.get("Checking")!,
			status: TransactionStatus.CATEGORIZED
		});

		transactions.push({
			date: new Date(monthDate.getFullYear(), monthDate.getMonth(), 22),
			description: "Amex Gold Payment",
			amount: randomAmount(400, 800),
			debitAccountId: accountMap.get("Credit Card:Amex Gold")!,
			creditAccountId: accountMap.get("Checking")!,
			status: TransactionStatus.CATEGORIZED
		});

		// Transfer to savings (once a month)
		transactions.push({
			date: new Date(monthDate.getFullYear(), monthDate.getMonth(), 3),
			description: "Transfer to Savings",
			amount: 500,
			debitAccountId: accountMap.get("Savings")!,
			creditAccountId: accountMap.get("Checking")!,
			status: TransactionStatus.CATEGORIZED
		});

		// Interest income (savings)
		transactions.push({
			date: new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0), // Last day of month
			description: "Interest Payment",
			amount: randomAmount(8, 25),
			debitAccountId: accountMap.get("Savings")!,
			creditAccountId: accountMap.get("Interest")!,
			status: TransactionStatus.CATEGORIZED
		});

		// Occasional freelance income (every 2-3 months)
		if (m % 3 === 0) {
			transactions.push({
				date: new Date(monthDate.getFullYear(), monthDate.getMonth(), randomDay(monthDate)),
				description: "Freelance Project - Client ABC",
				amount: randomAmount(800, 3000),
				debitAccountId: accountMap.get("Checking")!,
				creditAccountId: accountMap.get("Freelance")!,
				status: TransactionStatus.CATEGORIZED
			});
		}

		// Dividends (quarterly)
		if (m % 3 === 0) {
			transactions.push({
				date: new Date(monthDate.getFullYear(), monthDate.getMonth(), 15),
				description: "Dividend Payment - Vanguard",
				amount: randomAmount(50, 150),
				debitAccountId: accountMap.get("Checking")!,
				creditAccountId: accountMap.get("Dividends")!,
				status: TransactionStatus.CATEGORIZED
			});
		}

		// Travel expenses (every 4-6 months)
		if (m % 5 === 0 && m > 0) {
			const travelDay = randomDay(monthDate);
			transactions.push({
				date: new Date(monthDate.getFullYear(), monthDate.getMonth(), travelDay),
				description: randomItem(MERCHANTS.travel.filter((m) => m.includes("Airlines"))),
				amount: randomAmount(200, 600),
				debitAccountId: accountMap.get("Travel:Flights")!,
				creditAccountId: accountMap.get("Credit Card:Capital One Venture")!,
				status: TransactionStatus.CATEGORIZED
			});
			transactions.push({
				date: new Date(monthDate.getFullYear(), monthDate.getMonth(), travelDay + 1),
				description: randomItem(MERCHANTS.travel.filter((m) => m.includes("Hotel") || m.includes("Airbnb"))),
				amount: randomAmount(150, 400),
				debitAccountId: accountMap.get("Travel:Hotels")!,
				creditAccountId: accountMap.get("Credit Card:Capital One Venture")!,
				status: TransactionStatus.CATEGORIZED
			});
		}

		// Doctor visit (every 3-4 months)
		if (m % 4 === 1) {
			transactions.push({
				date: new Date(monthDate.getFullYear(), monthDate.getMonth(), randomDay(monthDate)),
				description: "Medical Center Copay",
				amount: randomAmount(20, 50),
				debitAccountId: accountMap.get("Health:Doctor")!,
				creditAccountId: randomCreditCard(accountMap),
				status: TransactionStatus.CATEGORIZED
			});
		}

		// Dental (twice a year)
		if (m % 6 === 0) {
			transactions.push({
				date: new Date(monthDate.getFullYear(), monthDate.getMonth(), randomDay(monthDate)),
				description: "Dental Associates",
				amount: randomAmount(50, 200),
				debitAccountId: accountMap.get("Health:Dental")!,
				creditAccountId: randomCreditCard(accountMap),
				status: TransactionStatus.CATEGORIZED
			});
		}

		// Add uncategorized transactions (more in recent months)
		const uncategorizedCount = isCurrentMonth ? 15 : isRecentMonth ? 8 : 3;
		for (let i = 0; i < uncategorizedCount; i++) {
			const card = randomCreditCard(accountMap);
			transactions.push({
				date: new Date(monthDate.getFullYear(), monthDate.getMonth(), randomDay(monthDate)),
				description: randomItem(UNCATEGORIZED_MERCHANTS),
				amount: randomAmount(5, 150),
				debitAccountId: null,
				creditAccountId: card,
				status: TransactionStatus.PENDING,
				importSource: card.includes("Chase")
					? "chase-import.csv"
					: card.includes("Amex")
						? "amex-import.csv"
						: "citi-import.csv"
			});
		}

		// Add some uncategorized from checking (ATM, transfers, etc)
		if (isRecentMonth) {
			for (let i = 0; i < 3; i++) {
				transactions.push({
					date: new Date(monthDate.getFullYear(), monthDate.getMonth(), randomDay(monthDate)),
					description: randomItem([
						"ATM Withdrawal",
						"ACH DEBIT",
						"WIRE TRANSFER",
						"CHECK #" + Math.floor(Math.random() * 9000 + 1000)
					]),
					amount: randomAmount(50, 300),
					debitAccountId: null,
					creditAccountId: accountMap.get("Checking")!,
					status: TransactionStatus.PENDING,
					importSource: "bank-import.csv"
				});
			}
		}
	}

	return transactions;
}

// Generate duplicate transactions for merge testing
function generateDuplicates(accountMap: Map<string, string>): GeneratedTransaction[] {
	const duplicates: GeneratedTransaction[] = [];
	const now = new Date();

	// Create some obvious duplicates from different import sources
	// These simulate the same transaction appearing in both checking and credit card imports

	// Duplicate pattern 1: Same amount, same date, slightly different description
	const duplicatePairs = [
		{
			desc1: "AMAZON.COM",
			desc2: "AMZN MKTP US*AB1CD2EF3",
			amount: 67.43,
			dayOffset: 0
		},
		{
			desc1: "UBER TRIP",
			desc2: "UBER *TRIP HELP.UBER.COM",
			amount: 23.5,
			dayOffset: 0
		},
		{
			desc1: "NETFLIX",
			desc2: "NETFLIX.COM",
			amount: 15.99,
			dayOffset: 0
		},
		{
			desc1: "TARGET",
			desc2: "TARGET T-1234",
			amount: 89.23,
			dayOffset: 1 // Sometimes posts a day apart
		},
		{
			desc1: "STARBUCKS",
			desc2: "STARBUCKS STORE 12345",
			amount: 6.75,
			dayOffset: 0
		},
		{
			desc1: "SHELL OIL",
			desc2: "SHELL SERVICE STATION",
			amount: 52.18,
			dayOffset: 0
		},
		{
			desc1: "SPOTIFY",
			desc2: "SPOTIFY USA",
			amount: 10.99,
			dayOffset: 0
		},
		{
			desc1: "CHIPOTLE",
			desc2: "CHIPOTLE ONLINE",
			amount: 14.25,
			dayOffset: 0
		}
	];

	for (const pair of duplicatePairs) {
		const baseDay = Math.floor(Math.random() * 20) + 1;
		const card = randomCreditCard(accountMap);

		// First version (e.g., from credit card statement)
		duplicates.push({
			date: new Date(now.getFullYear(), now.getMonth(), baseDay),
			description: pair.desc1,
			amount: pair.amount,
			debitAccountId: null,
			creditAccountId: card,
			status: TransactionStatus.PENDING,
			importSource: "credit-card-march.csv"
		});

		// Second version (e.g., from bank download)
		duplicates.push({
			date: new Date(now.getFullYear(), now.getMonth(), baseDay + pair.dayOffset),
			description: pair.desc2,
			amount: pair.amount,
			debitAccountId: null,
			creditAccountId: card,
			status: TransactionStatus.PENDING,
			importSource: "credit-card-ofx.ofx"
		});
	}

	// Add some near-duplicates with slightly different amounts (not actual duplicates)
	// These test the UI's ability to show potential matches that aren't duplicates
	duplicates.push({
		date: new Date(now.getFullYear(), now.getMonth(), 5),
		description: "WHOLE FOODS MKT",
		amount: 45.67,
		debitAccountId: null,
		creditAccountId: accountMap.get("Credit Card:Chase Freedom")!,
		status: TransactionStatus.PENDING,
		importSource: "chase-march.csv"
	});
	duplicates.push({
		date: new Date(now.getFullYear(), now.getMonth(), 5),
		description: "WHOLE FOODS MARKET",
		amount: 45.89, // Different amount - NOT a duplicate
		debitAccountId: null,
		creditAccountId: accountMap.get("Credit Card:Chase Freedom")!,
		status: TransactionStatus.PENDING,
		importSource: "chase-march.csv"
	});

	return duplicates;
}

async function seedDemo(deleteExisting = false) {
	console.log("Creating Demo book...");

	// Check if demo already exists
	const existing = await db.book.findFirst({ where: { isDemo: true } });
	if (existing) {
		if (deleteExisting) {
			console.log("Deleting existing Demo book...");
			await db.book.delete({ where: { id: existing.id } });
		} else {
			console.log("Demo book already exists. Use --reset to delete and recreate.");
			console.log(`  Book ID: ${existing.id}`);
			return existing;
		}
	}

	// Create demo book
	const book = await db.book.create({
		data: {
			name: "Demo",
			description: "Sample data to explore Moneypit",
			isDemo: true
		}
	});

	console.log(`Created Demo book: ${book.id}`);

	// Seed tax categories
	await db.taxCategory.createMany({
		data: DEFAULT_TAX_CATEGORIES.map((cat) => ({
			bookId: book.id,
			...cat
		}))
	});
	console.log(`Created ${DEFAULT_TAX_CATEGORIES.length} tax categories`);

	// Create accounts
	const accountMap = new Map<string, string>();
	for (const acc of DEMO_ACCOUNTS) {
		const created = await db.account.create({
			data: {
				bookId: book.id,
				type: acc.type,
				path: acc.path,
				last4: acc.last4
			}
		});
		accountMap.set(acc.path, created.id);
	}
	console.log(`Created ${DEMO_ACCOUNTS.length} accounts`);

	// Set opening balances
	await db.account.update({
		where: { id: accountMap.get("Checking") },
		data: { openingBalance: 8500 }
	});
	await db.account.update({
		where: { id: accountMap.get("Savings") },
		data: { openingBalance: 25000 }
	});
	await db.account.update({
		where: { id: accountMap.get("Venmo") },
		data: { openingBalance: 150 }
	});

	// Generate transactions (24 months)
	const transactions = generateTransactions(accountMap, 24);

	// Generate duplicates for merge testing
	const duplicates = generateDuplicates(accountMap, transactions);
	transactions.push(...duplicates);

	// Separate categorized and pending transactions
	const categorizedTxs = transactions.filter((tx) => tx.debitAccountId !== null);
	const pendingTxs = transactions.filter((tx) => tx.debitAccountId === null);

	// Create categorized transactions in bulk
	await db.transaction.createMany({
		data: categorizedTxs.map((tx) => ({
			bookId: book.id,
			date: tx.date,
			description: tx.description,
			amount: tx.amount,
			debitAccountId: tx.debitAccountId,
			creditAccountId: tx.creditAccountId,
			status: tx.status,
			importSource: tx.importSource
		}))
	});

	// Create pending transactions separately (with null debit)
	for (const tx of pendingTxs) {
		await db.transaction.create({
			data: {
				bookId: book.id,
				date: tx.date,
				description: tx.description,
				amount: tx.amount,
				debitAccountId: null,
				creditAccountId: tx.creditAccountId,
				status: TransactionStatus.PENDING,
				importSource: tx.importSource
			}
		});
	}

	console.log(
		`Created ${transactions.length} transactions (${pendingTxs.length} pending, ${duplicates.length} potential duplicates)`
	);

	// Create rules
	const rules = [
		{
			pattern: "Starbucks|Peet|Blue Bottle|Dunkin|Dutch Bros|Philz",
			accountId: accountMap.get("Food:Coffee")!,
			isRegex: true
		},
		{
			pattern: "Netflix|Spotify|HBO|Disney|Hulu|Apple TV|YouTube Premium|Peacock",
			accountId: accountMap.get("Entertainment:Streaming")!,
			isRegex: true
		},
		{
			pattern: "Shell|Chevron|76|Costco Gas|Exxon|Mobil|BP|Speedway",
			accountId: accountMap.get("Transportation:Gas")!,
			isRegex: true
		},
		{
			pattern: "Whole Foods|Trader|Safeway|Costco|Kroger|Aldi|Publix|H-E-B|Sprouts",
			accountId: accountMap.get("Food:Groceries")!,
			isRegex: true
		},
		{
			pattern: "Chipotle|Panera|Thai Kitchen|Olive Garden|Applebee|Chilis|Buffalo Wild",
			accountId: accountMap.get("Food:Restaurants")!,
			isRegex: true
		},
		{
			pattern: "Uber(?! Eats)|Lyft",
			accountId: accountMap.get("Transportation:Rideshare")!,
			isRegex: true
		},
		{
			pattern: "DoorDash|Uber Eats|Grubhub|Postmates|Seamless",
			accountId: accountMap.get("Food:Takeout")!,
			isRegex: true
		},
		{
			pattern: "Amazon|AMZN",
			accountId: accountMap.get("Shopping:Electronics")!,
			isRegex: true
		},
		{
			pattern: "CVS|Walgreens|Rite Aid",
			accountId: accountMap.get("Health:Pharmacy")!,
			isRegex: true
		},
		{
			pattern: "Petco|PetSmart|Chewy",
			accountId: accountMap.get("Pets:Food")!,
			isRegex: true
		}
	];
	for (const rule of rules) {
		await db.rule.create({
			data: {
				bookId: book.id,
				pattern: rule.pattern,
				accountId: rule.accountId,
				isRegex: rule.isRegex,
				field: "description"
			}
		});
	}
	console.log(`Created ${rules.length} rules`);

	// Add some balance records
	const now = new Date();
	await db.balanceRecord.create({
		data: {
			accountId: accountMap.get("Checking")!,
			date: new Date(now.getFullYear(), now.getMonth(), 1),
			balance: 6523.45
		}
	});
	await db.balanceRecord.create({
		data: {
			accountId: accountMap.get("Savings")!,
			date: new Date(now.getFullYear(), now.getMonth(), 1),
			balance: 37234.67
		}
	});
	await db.balanceRecord.create({
		data: {
			accountId: accountMap.get("Credit Card:Chase Freedom")!,
			date: new Date(now.getFullYear(), now.getMonth(), 1),
			balance: -1234.56
		}
	});
	console.log("Created 3 balance records");

	console.log("\nDemo data seeded successfully!");
	console.log(`Switch to it with: bin/mp book:switch ${book.id}`);

	return book;
}

// Run if executed directly
const args = process.argv.slice(2);
const reset = args.includes("--reset");

seedDemo(reset)
	.catch(console.error)
	.finally(() => process.exit(0));
