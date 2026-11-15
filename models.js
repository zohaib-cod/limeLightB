import mongoose from 'mongoose';

const schemaOptions = {
  strict: false,
  timestamps: true
};

export const Product = mongoose.models.Product || mongoose.model('Product', new mongoose.Schema({
  id: { type: String, unique: true, index: true },
  title: { type: String, required: true },
  category: String,
  subCategory: String,
  fabric: String,
  pieces: String,
  fit: String,
  sizes: [String],
  color: String,
  price: Number,
  originalPrice: Number,
  discount: String,
  sku: String,
  image: String,
  isActive: { type: Boolean, default: true },
  inStock: { type: Boolean, default: true }
}, schemaOptions));

export const Order = mongoose.models.Order || mongoose.model('Order', new mongoose.Schema({
  id: { type: String, unique: true, index: true },
  orderNumber: String,
  customerName: String,
  email: String,
  phone: String,
  address: String,
  city: String,
  postalCode: String,
  notes: String,
  items: Array,
  subtotal: Number,
  shippingFee: Number,
  discount: Number,
  total: Number,
  status: { type: String, default: 'Pending' },
  paymentMethod: { type: String, default: 'COD' },
  trackingId: String,
  userId: String
}, schemaOptions));

export const User = mongoose.models.User || mongoose.model('User', new mongoose.Schema({
  id: { type: String, unique: true, index: true },
  name: String,
  email: { type: String, index: true },
  phone: String,
  city: String,
  address: String,
  ordersCount: { type: Number, default: 0 },
  totalSpent: { type: Number, default: 0 },
  isRegistered: { type: Boolean, default: true },
  lastLoginAt: Date
}, schemaOptions));

export const Navigation = mongoose.models.Navigation || mongoose.model('Navigation', new mongoose.Schema({
  id: { type: String, unique: true, index: true },
  name: String,
  slug: String,
  href: String,
  isSale: Boolean,
  order: Number,
  isActive: { type: Boolean, default: true },
  description: String,
  columns: Array
}, schemaOptions));

export const Setting = mongoose.models.Setting || mongoose.model('Setting', new mongoose.Schema({
  key: { type: String, unique: true, default: 'site_settings' },
  logoType: { type: String, default: 'text' },
  textLogo: Object,
  imageLogo: Object,
  whatsappNumber: { type: String, default: '+92 345 7867016' }
}, schemaOptions));

export const Slide = mongoose.models.Slide || mongoose.model('Slide', new mongoose.Schema({
  id: { type: String, unique: true, index: true },
  title: String,
  subtitle: String,
  tag: String,
  buttonText: String,
  buttonLink: String,
  desktopImage: String,
  mobileImage: String,
  order: Number,
  isActive: { type: Boolean, default: true }
}, schemaOptions));

export const Banner = mongoose.models.Banner || mongoose.model('Banner', new mongoose.Schema({
  id: { type: String, unique: true, index: true },
  section: String,
  sectionName: String,
  badge: String,
  watermark: String,
  title: String,
  subtitle: String,
  scriptText: String,
  buttonText: String,
  buttonLink: String,
  secondaryBtnText: String,
  secondaryBtnLink: String,
  imageUrl: String,
  isActive: { type: Boolean, default: true }
}, schemaOptions));

export const Collection = mongoose.models.Collection || mongoose.model('Collection', new mongoose.Schema({
  id: { type: String, unique: true, index: true },
  title: String,
  count: String,
  link: String,
  image: String,
  tag: String,
  subtitle: String,
  order: Number,
  isActive: { type: Boolean, default: true }
}, schemaOptions));

export const NewArrival = mongoose.models.NewArrival || mongoose.model('NewArrival', new mongoose.Schema({
  id: { type: String, unique: true, index: true },
  title: String,
  category: String,
  fabric: String,
  price: Number,
  originalPrice: Number,
  discount: String,
  badge: String,
  image: String,
  inStock: { type: Boolean, default: true },
  isActive: { type: Boolean, default: true },
  order: Number
}, schemaOptions));

export const Feature = mongoose.models.Feature || mongoose.model('Feature', new mongoose.Schema({
  id: { type: String, unique: true, index: true },
  title: String,
  subtitle: String,
  icon: String,
  order: Number,
  isActive: { type: Boolean, default: true }
}, schemaOptions));

export const Section = mongoose.models.Section || mongoose.model('Section', new mongoose.Schema({
  id: { type: String, unique: true, index: true },
  name: String,
  description: String,
  order: Number,
  enabled: { type: Boolean, default: true }
}, schemaOptions));

export const Footer = mongoose.models.Footer || mongoose.model('Footer', new mongoose.Schema({
  key: { type: String, unique: true, default: 'site_footer' },
  newsletter: Object,
  customerCare: Object,
  information: Object,
  contact: Object,
  connect: Object,
  bottomBar: Object
}, schemaOptions));

export const Subscriber = mongoose.models.Subscriber || mongoose.model('Subscriber', new mongoose.Schema({
  id: { type: String, unique: true, index: true },
  email: { type: String, required: true, unique: true, index: true },
  status: { type: String, default: 'active' },
  source: { type: String, default: 'Storefront Footer' },
  subscribedAt: { type: Date, default: Date.now }
}, schemaOptions));


