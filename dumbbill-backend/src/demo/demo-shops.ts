import { gstinCheckCharacter } from '../modules/business/domain/gstin';

/**
 * The three demo businesses, each with two branches, an owner, an admin and a cashier.
 *
 * Everything here is invented: names, people, phone numbers and e-mail addresses (on the reserved `.test` domain, which
 * can never receive real mail). The GSTINs are not registered anywhere; they only pass the same shape and check-character
 * rules the product applies, so the GST screens can be tried with believable numbers.
 *
 * The demo sign-in password is the same for every demo person and is printed by the seed command. It is for a local
 * database only: the seed refuses to run in production or against a remote database.
 */

/** One demo branch. */
export interface DemoBranch {
  name: string;
  /** Invoice prefix: 1 to 6 capital letters or digits, unique inside the business. */
  prefix: string;
  addressLine: string;
  pincode: string;
  phone: string;
}

/** One demo business. */
export interface DemoShop {
  /** Short code used in invoice numbers and idempotency keys. */
  code: string;
  name: string;
  ownerName: string;
  adminName: string;
  cashierName: string;
  /** Written into e-mail addresses: owner@<emailDomain>, admin@..., cashier@... */
  emailDomain: string;
  city: string;
  /** GST state code (two digits). Maharashtra 27, Karnataka 29, Delhi 07. */
  stateCode: string;
  /** A made-up PAN (the 10-character tax id inside a GSTIN). */
  pan: string;
  phone: string;
  branches: [DemoBranch, DemoBranch];
}

/** The password every demo person signs in with. */
export const DEMO_PASSWORD = 'Dumbbill-demo-2026';

export const DEMO_SHOPS: readonly DemoShop[] = [
  {
    code: 'ITN',
    name: 'Iron Temple Nutrition',
    ownerName: 'Rohan Deshmukh',
    adminName: 'Sneha Kulkarni',
    cashierName: 'Imran Shaikh',
    emailDomain: 'irontemple.demo.test',
    city: 'Pune',
    stateCode: '27',
    pan: 'AAFCI4521K',
    phone: '9822001100',
    branches: [
      {
        name: 'Koregaon Park',
        prefix: 'KP',
        addressLine: 'Shop 4, Lane 6, Koregaon Park',
        pincode: '411001',
        phone: '9822001101',
      },
      {
        name: 'Baner',
        prefix: 'BAN',
        addressLine: 'Ground floor, Sakal Nagar Road, Baner',
        pincode: '411045',
        phone: '9822001102',
      },
    ],
  },
  {
    code: 'FFS',
    name: 'FitFuel Supplements',
    ownerName: 'Ananya Rao',
    adminName: 'Karthik Gowda',
    cashierName: 'Divya Nair',
    emailDomain: 'fitfuel.demo.test',
    city: 'Bengaluru',
    stateCode: '29',
    pan: 'AAHCF7788M',
    phone: '9845002200',
    branches: [
      {
        name: 'Indiranagar',
        prefix: 'IND',
        addressLine: '100 Feet Road, Indiranagar',
        pincode: '560038',
        phone: '9845002201',
      },
      {
        name: 'Koramangala',
        prefix: 'KOR',
        addressLine: '5th Block, Koramangala',
        pincode: '560095',
        phone: '9845002202',
      },
    ],
  },
  {
    code: 'MMD',
    name: 'Muscle Mart Delhi',
    ownerName: 'Gurpreet Singh',
    adminName: 'Neha Arora',
    cashierName: 'Vikas Yadav',
    emailDomain: 'musclemart.demo.test',
    city: 'New Delhi',
    stateCode: '07',
    pan: 'AAKPS3344R',
    phone: '9811003300',
    branches: [
      {
        name: 'Lajpat Nagar',
        prefix: 'LJP',
        addressLine: 'Central Market, Lajpat Nagar II',
        pincode: '110024',
        phone: '9811003301',
      },
      {
        name: 'Rajouri Garden',
        prefix: 'RJG',
        addressLine: 'J Block Market, Rajouri Garden',
        pincode: '110027',
        phone: '9811003302',
      },
    ],
  },
];

/**
 * A GSTIN that passes the product's shape and check-character rules: state code + PAN + entity number + "Z" + check
 * character. `entity` is 1 for the first registration in a state, 2 for the next, and so on.
 */
export function demoGstin(stateCode: string, pan: string, entity: number): string {
  const first14 = `${stateCode}${pan}${entity}Z`;
  return `${first14}${gstinCheckCharacter(first14)}`;
}
