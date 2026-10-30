import React, { useState } from 'react';
import { FileText, DollarSign, Users, Zap } from 'lucide-react';

const BusinessModelCanvas = () => {
  const [activeTab, setActiveTab] = useState('canvas');

  const CanvasSection = ({ title, items, color }) => (
    <div className={`border-2 ${color} rounded-lg p-4 h-full`}>
      <h3 className="font-bold text-sm mb-2 text-gray-800">{title}</h3>
      <ul className="text-xs space-y-1">
        {items.map((item, idx) => (
          <li key={idx} className="text-gray-700">• {item}</li>
        ))}
      </ul>
    </div>
  );

  const CostProjections = () => (
    <div className="space-y-6">
      <div className="bg-blue-50 p-6 rounded-lg">
        <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
          <DollarSign className="w-6 h-6" />
          Year 1 Financial Projections
        </h3>
        
        <div className="grid md:grid-cols-2 gap-6 mb-6">
          <div className="bg-white p-4 rounded shadow">
            <h4 className="font-bold text-lg mb-3 text-red-600">Startup Costs</h4>
            <table className="w-full text-sm">
              <tbody>
                <tr className="border-b">
                  <td className="py-2">Smart Contract Development</td>
                  <td className="text-right font-mono">$5,000</td>
                </tr>
                <tr className="border-b">
                  <td className="py-2">Security Audit</td>
                  <td className="text-right font-mono">$8,000</td>
                </tr>
                <tr className="border-b">
                  <td className="py-2">Frontend Development</td>
                  <td className="text-right font-mono">$12,000</td>
                </tr>
                <tr className="border-b">
                  <td className="py-2">Backend Infrastructure</td>
                  <td className="text-right font-mono">$6,000</td>
                </tr>
                <tr className="border-b">
                  <td className="py-2">Legal Setup & Compliance</td>
                  <td className="text-right font-mono">$4,000</td>
                </tr>
                <tr className="border-b">
                  <td className="py-2">Branding & Design</td>
                  <td className="text-right font-mono">$3,000</td>
                </tr>
                <tr className="border-b">
                  <td className="py-2">Initial Marketing</td>
                  <td className="text-right font-mono">$5,000</td>
                </tr>
                <tr className="font-bold bg-red-50">
                  <td className="py-2">Total Startup</td>
                  <td className="text-right font-mono">$43,000</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="bg-white p-4 rounded shadow">
            <h4 className="font-bold text-lg mb-3 text-orange-600">Monthly Operating Costs</h4>
            <table className="w-full text-sm">
              <tbody>
                <tr className="border-b">
                  <td className="py-2">Cloud Hosting (AWS/Vercel)</td>
                  <td className="text-right font-mono">$200</td>
                </tr>
                <tr className="border-b">
                  <td className="py-2">IPFS Storage (Pinata)</td>
                  <td className="text-right font-mono">$150</td>
                </tr>
                <tr className="border-b">
                  <td className="py-2">RPC Node Services (Alchemy)</td>
                  <td className="text-right font-mono">$100</td>
                </tr>
                <tr className="border-b">
                  <td className="py-2">Domain & SSL</td>
                  <td className="text-right font-mono">$20</td>
                </tr>
                <tr className="border-b">
                  <td className="py-2">Customer Support Tools</td>
                  <td className="text-right font-mono">$80</td>
                </tr>
                <tr className="border-b">
                  <td className="py-2">Marketing & Ads</td>
                  <td className="text-right font-mono">$1,000</td>
                </tr>
                <tr className="border-b">
                  <td className="py-2">Miscellaneous</td>
                  <td className="text-right font-mono">$150</td>
                </tr>
                <tr className="font-bold bg-orange-50">
                  <td className="py-2">Monthly Total</td>
                  <td className="text-right font-mono">$1,700</td>
                </tr>
                <tr className="font-bold bg-orange-100">
                  <td className="py-2">Annual Operating</td>
                  <td className="text-right font-mono">$20,400</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-white p-4 rounded shadow mb-6">
          <h4 className="font-bold text-lg mb-3 text-green-600">Revenue Projections - Year 1</h4>
          <div className="grid md:grid-cols-3 gap-4 mb-4">
            <div className="bg-green-50 p-3 rounded">
              <div className="text-xs text-gray-600">Conservative</div>
              <div className="text-2xl font-bold text-green-700">$48,000</div>
              <div className="text-xs text-gray-600">400 paid users</div>
            </div>
            <div className="bg-green-100 p-3 rounded">
              <div className="text-xs text-gray-600">Moderate</div>
              <div className="text-2xl font-bold text-green-700">$96,000</div>
              <div className="text-xs text-gray-600">800 paid users</div>
            </div>
            <div className="bg-green-200 p-3 rounded">
              <div className="text-xs text-gray-600">Optimistic</div>
              <div className="text-2xl font-bold text-green-700">$180,000</div>
              <div className="text-xs text-gray-600">1,500 paid users</div>
            </div>
          </div>
          
          <table className="w-full text-sm">
            <thead className="bg-gray-100">
              <tr>
                <th className="text-left py-2 px-2">Tier</th>
                <th className="text-right py-2 px-2">Price</th>
                <th className="text-right py-2 px-2">Users (Mod)</th>
                <th className="text-right py-2 px-2">Annual Revenue</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b">
                <td className="py-2 px-2">Free Tier</td>
                <td className="text-right font-mono">$0</td>
                <td className="text-right font-mono">2,000</td>
                <td className="text-right font-mono">$0</td>
              </tr>
              <tr className="border-b">
                <td className="py-2 px-2">Creator ($10/mo)</td>
                <td className="text-right font-mono">$120/yr</td>
                <td className="text-right font-mono">600</td>
                <td className="text-right font-mono">$72,000</td>
              </tr>
              <tr className="border-b">
                <td className="py-2 px-2">Professional ($25/mo)</td>
                <td className="text-right font-mono">$300/yr</td>
                <td className="text-right font-mono">150</td>
                <td className="text-right font-mono">$45,000</td>
              </tr>
              <tr className="border-b">
                <td className="py-2 px-2">Studio ($100/mo)</td>
                <td className="text-right font-mono">$1,200/yr</td>
                <td className="text-right font-mono">20</td>
                <td className="text-right font-mono">$24,000</td>
              </tr>
              <tr className="border-b">
                <td className="py-2 px-2">One-time Registrations</td>
                <td className="text-right font-mono">$2 each</td>
                <td className="text-right font-mono">2,500</td>
                <td className="text-right font-mono">$5,000</td>
              </tr>
              <tr className="font-bold bg-green-50">
                <td className="py-2 px-2" colSpan="3">Total Annual Revenue</td>
                <td className="text-right font-mono">$146,000</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <div className="bg-white p-4 rounded shadow">
            <h4 className="font-bold text-lg mb-3">Break-Even Analysis</h4>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between border-b py-2">
                <span>Total Year 1 Costs:</span>
                <span className="font-mono font-bold">$63,400</span>
              </div>
              <div className="flex justify-between border-b py-2">
                <span>Moderate Revenue:</span>
                <span className="font-mono font-bold text-green-600">$146,000</span>
              </div>
              <div className="flex justify-between border-b py-2 bg-green-50">
                <span className="font-bold">Year 1 Profit:</span>
                <span className="font-mono font-bold text-green-700">$82,600</span>
              </div>
              <div className="flex justify-between py-2">
                <span>Break-even month:</span>
                <span className="font-bold">Month 5-6</span>
              </div>
            </div>
          </div>

          <div className="bg-white p-4 rounded shadow">
            <h4 className="font-bold text-lg mb-3">Unit Economics</h4>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between border-b py-2">
                <span>Avg Customer Lifetime Value:</span>
                <span className="font-mono font-bold">$240</span>
              </div>
              <div className="flex justify-between border-b py-2">
                <span>Customer Acquisition Cost:</span>
                <span className="font-mono font-bold">$15</span>
              </div>
              <div className="flex justify-between border-b py-2 bg-blue-50">
                <span className="font-bold">LTV:CAC Ratio:</span>
                <span className="font-mono font-bold text-blue-700">16:1</span>
              </div>
              <div className="flex justify-between py-2">
                <span>Gross Margin:</span>
                <span className="font-bold">~85%</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-purple-50 p-6 rounded-lg">
        <h3 className="text-xl font-bold mb-4">Transaction Cost Breakdown</h3>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="bg-white p-4 rounded shadow">
            <h4 className="font-bold mb-3">Per Registration Costs</h4>
            <table className="w-full text-sm">
              <tbody>
                <tr className="border-b">
                  <td className="py-2">Gas Fee (Base L2)</td>
                  <td className="text-right font-mono">$0.01</td>
                </tr>
                <tr className="border-b">
                  <td className="py-2">IPFS Storage (optional)</td>
                  <td className="text-right font-mono">$0.03</td>
                </tr>
                <tr className="border-b">
                  <td className="py-2">Processing Overhead</td>
                  <td className="text-right font-mono">$0.01</td>
                </tr>
                <tr className="font-bold bg-purple-50">
                  <td className="py-2">Total Cost</td>
                  <td className="text-right font-mono">$0.05</td>
                </tr>
                <tr className="font-bold bg-green-50">
                  <td className="py-2">Charge to User</td>
                  <td className="text-right font-mono">$0.50-2.00</td>
                </tr>
                <tr className="font-bold bg-green-100">
                  <td className="py-2">Profit per Transaction</td>
                  <td className="text-right font-mono">$0.45-1.95</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="bg-white p-4 rounded shadow">
            <h4 className="font-bold mb-3">Pricing Tiers Detail</h4>
            <div className="space-y-3 text-sm">
              <div className="border-l-4 border-gray-400 pl-3">
                <div className="font-bold">Free Tier</div>
                <div className="text-xs text-gray-600">5 registrations/month</div>
              </div>
              <div className="border-l-4 border-blue-400 pl-3">
                <div className="font-bold">Creator - $10/month</div>
                <div className="text-xs text-gray-600">50 registrations/month, timeline view</div>
              </div>
              <div className="border-l-4 border-purple-400 pl-3">
                <div className="font-bold">Professional - $25/month</div>
                <div className="text-xs text-gray-600">Unlimited registrations, API access, collaboration tools</div>
              </div>
              <div className="border-l-4 border-yellow-400 pl-3">
                <div className="font-bold">Studio - $100/month</div>
                <div className="text-xs text-gray-600">Multi-user accounts, white-label, priority support</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="max-w-7xl mx-auto p-6 bg-gray-50">
      <div className="bg-gradient-to-r from-blue-600 to-purple-600 text-white p-6 rounded-lg mb-6">
        <h1 className="text-3xl font-bold mb-2">ProofStream Business Model</h1>
        <p className="text-blue-100">Blockchain-Based Creative Timeline & IP Protection Platform</p>
      </div>

      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setActiveTab('canvas')}
          className={`px-4 py-2 rounded-lg font-semibold flex items-center gap-2 ${
            activeTab === 'canvas' ? 'bg-blue-600 text-white' : 'bg-white text-gray-700'
          }`}
        >
          <FileText className="w-4 h-4" />
          Business Model Canvas
        </button>
        <button
          onClick={() => setActiveTab('costs')}
          className={`px-4 py-2 rounded-lg font-semibold flex items-center gap-2 ${
            activeTab === 'costs' ? 'bg-blue-600 text-white' : 'bg-white text-gray-700'
          }`}
        >
          <DollarSign className="w-4 h-4" />
          Cost Projections
        </button>
      </div>

      {activeTab === 'canvas' && (
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <div className="md:col-span-2 space-y-4">
            <CanvasSection
              title="Key Partners"
              color="border-blue-300"
              items={[
                'Blockchain infrastructure (Alchemy, Infura)',
                'IPFS storage providers (Pinata, Web3.Storage)',
                'Legal tech platforms for document generation',
                'Artist associations & creator communities',
                'Web3 wallet providers (MetaMask, WalletConnect)',
                'Education platforms for creator onboarding'
              ]}
            />
            <CanvasSection
              title="Key Activities"
              color="border-purple-300"
              items={[
                'Smart contract development & maintenance',
                'User onboarding & education',
                'Content verification & timestamping',
                'Community building & support',
                'Marketing to creator communities',
                'Legal template generation',
                'Platform security & auditing'
              ]}
            />
            <CanvasSection
              title="Key Resources"
              color="border-green-300"
              items={[
                'Smart contracts on multiple chains',
                'Development team (2-3 developers)',
                'Cloud infrastructure',
                'IPFS storage network',
                'Legal expertise & templates',
                'Creator community & testimonials',
                'Brand reputation & trust'
              ]}
            />
          </div>

          <div className="md:col-span-1 space-y-4">
            <CanvasSection
              title="Value Propositions"
              color="border-red-300"
              items={[
                '1000x cheaper than traditional copyright',
                'Instant global protection',
                'Immutable proof of creation',
                'Timeline of creative process',
                'No geographic limitations',
                'Self-sovereign ownership',
                'Legal-ready documentation',
                'Collaboration proof',
                'Privacy options available'
              ]}
            />
          </div>

          <div className="md:col-span-2 space-y-4">
            <CanvasSection
              title="Customer Relationships"
              color="border-yellow-300"
              items={[
                'Self-service platform with tutorials',
                'Community forums & Discord',
                'Email support (24-48hr response)',
                'Educational content (blog, videos)',
                'Premium support for paid tiers',
                'Creator showcase & success stories',
                'Referral program'
              ]}
            />
            <CanvasSection
              title="Channels"
              color="border-pink-300"
              items={[
                'Web platform (proofstream.io)',
                'Social media (Twitter, Instagram, TikTok)',
                'Creator communities (Reddit, Discord)',
                'Art & music festivals/events',
                'University partnerships',
                'Content creator podcasts',
                'SEO & content marketing',
                'Web3 community partnerships'
              ]}
            />
            <CanvasSection
              title="Customer Segments"
              color="border-indigo-300"
              items={[
                'Independent musicians & artists',
                'Writers & authors',
                'Photographers & videographers',
                'Software developers (code)',
                'Designers & illustrators',
                'Inventors & entrepreneurs',
                'Students & academics',
                'Small creative studios',
                'Indigenous communities (traditional knowledge)'
              ]}
            />
          </div>

          <div className="md:col-span-3">
            <CanvasSection
              title="Cost Structure"
              color="border-orange-300"
              items={[
                'Development: Smart contracts, frontend, backend ($23K startup)',
                'Security: Audits & ongoing monitoring ($8K startup + ongoing)',
                'Infrastructure: Cloud hosting, IPFS, RPC nodes ($200-300/mo)',
                'Marketing: Digital ads, content, events ($1K/mo + $5K startup)',
                'Operations: Support tools, domain, misc ($250/mo)',
                'Legal: Setup, compliance, templates ($4K startup)',
                'Model: Low fixed costs, high gross margins (~85%)'
              ]}
            />
          </div>

          <div className="md:col-span-2">
            <CanvasSection
              title="Revenue Streams"
              color="border-green-300"
              items={[
                'Free Tier: 5 registrations/mo (lead generation)',
                'Creator: $10/mo - 50 registrations',
                'Professional: $25/mo - unlimited + API',
                'Studio: $100/mo - team accounts',
                'Pay-per-use: $0.50-2 per registration',
                'Legal docs: $50 for court-ready certificates',
                'API access: $50-200/mo for integrations',
                'White-label: $500-2K/mo for platforms'
              ]}
            />
          </div>
        </div>
      )}

      {activeTab === 'costs' && <CostProjections />}

      <div className="mt-8 bg-white p-6 rounded-lg shadow">
        <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
          <Zap className="w-6 h-6 text-yellow-500" />
          Competitive Advantages
        </h3>
        <div className="grid md:grid-cols-3 gap-4">
          <div className="border-l-4 border-blue-500 pl-4">
            <h4 className="font-bold text-blue-700 mb-2">Cost Leadership</h4>
            <p className="text-sm text-gray-700">US Copyright Office charges $45-125 per work. ProofStream costs $0.10-2 per registration (98% savings)</p>
          </div>
          <div className="border-l-4 border-purple-500 pl-4">
            <h4 className="font-bold text-purple-700 mb-2">Innovation</h4>
            <p className="text-sm text-gray-700">First platform to offer continuous creative timeline on blockchain, not just one-time registration</p>
          </div>
          <div className="border-l-4 border-green-500 pl-4">
            <h4 className="font-bold text-green-700 mb-2">Network Effect</h4>
            <p className="text-sm text-gray-700">More users = more verified creations = stronger proof system = attracts more users</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BusinessModelCanvas;