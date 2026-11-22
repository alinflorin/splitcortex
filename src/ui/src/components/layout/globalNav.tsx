import {
  Building24Filled,
  Building24Regular,
  Chat24Filled,
  Chat24Regular,
  Home24Filled,
  Home24Regular,
  Info24Filled,
  Info24Regular,
  Mail24Filled,
  Mail24Regular,
  bundleIcon,
} from '@fluentui/react-icons';

/** The top-level destinations, in the order shown in the top bar and in the mobile drawer. */
export const GLOBAL_ITEMS = [
  { to: '/', key: 'home', Icon: bundleIcon(Home24Filled, Home24Regular) },
  {
    to: '/organisations',
    key: 'organisations',
    Icon: bundleIcon(Building24Filled, Building24Regular),
  },
  { to: '/playground', key: 'playground', Icon: bundleIcon(Chat24Filled, Chat24Regular) },
  { to: '/about', key: 'about', Icon: bundleIcon(Info24Filled, Info24Regular) },
  { to: '/contact', key: 'contact', Icon: bundleIcon(Mail24Filled, Mail24Regular) },
] as const;
