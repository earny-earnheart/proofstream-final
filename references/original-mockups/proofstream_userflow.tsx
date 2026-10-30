import React, { useState } from 'react';
import { 
  Home, Upload, CheckCircle, Clock, Eye, Users, 
  FileText, Shield, ArrowRight, Plus, Search, Menu,
  Wallet, Settings, LogOut, ChevronDown, Hash, Lock
} from 'lucide-react';

const ProofStreamWireframes = () => {
  const [currentScreen, setCurrentScreen] = useState('landing');
  const [showMobileMenu, setShowMobileMenu] = useState(false);

  const Navigation = ({ minimal = false }) => (
    <nav className="bg-gradient-to-r from-blue-600 to-purple-600 text-white p-4 shadow-lg">
      <div className="max-w-7xl mx-auto flex justify-between items-center">
        <div className="flex items-center gap-2">
          <Shield className="w-8 h-8" />
          <span className="text-2xl font-bold">ProofStream</span>
        </div>
        {!minimal && (
          <div className="hidden md:flex items-center gap-6">
            <a href="#how" className="hover:text-blue-200">How It Works</a>
            <a href="#pricing" className="hover:text-blue-200">Pricing</a>
            <a href="#verify" className="hover:text-blue-200">Verify</a>
            <button className="bg-white text-blue-600 px-4 py-2 rounded-lg font-semibold hover:bg-blue-50 flex items-center gap-2">
              <Wallet className="w-4 h-4" />
              Connect Wallet
            </button>
          </div>
        )}
        <button className="md:hidden" onClick={() => setShowMobileMenu(!showMobileMenu)}>
          <Menu className="w-6 h-6" />
        </button>
      </div>
    </nav>
  );

  const ScreenSelector = () => (
    <div className="bg-gray-800 text-white p-4 overflow-x-auto">
      <div className="flex gap-2 min-w-max">
        {[
          { id: 'landing', label: 'Landing' },
          { id: 'onboarding', label: 'Onboarding' },
          { id: 'dashboard', label: 'Dashboard' },
          { id: 'create-project', label: 'Create Project' },
          { id: 'register', label: 'Register Work' },
          { id: 'timeline', label: 'Timeline View' },
          { id: 'verify', label: 'Verify Content' }
        ].map(screen => (
          <button
            key={screen.id}
            onClick={() => setCurrentScreen(screen.id)}
            className={`px-4 py-2 rounded whitespace-nowrap ${
              currentScreen === screen.id 
                ? 'bg-blue-600' 
                : 'bg-gray-700 hover:bg-gray-600'
            }`}
          >
            {screen.label}
          </button>
        ))}
      </div>
    </div>
  );

  const LandingScreen = () => (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white">
      <Navigation />
      
      <div className="max-w-7xl mx-auto px-4 py-20">
        <div className="text-center mb-16">
          <h1 className="text-5xl font-bold text-gray-900 mb-6">
            Protect Your Creative Work
            <br/>
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-purple-600">
              Before You Share It
            </span>
          </h1>
          <p className="text-xl text-gray-600 mb-8 max-w-2xl mx-auto">
            Blockchain-powered proof of creation. Register your work, track your creative process, 
            and establish irrefutable ownership—all for pennies.
          </p>
          <div className="flex gap-4 justify-center flex-wrap">
            <button 
              onClick={() => setCurrentScreen('onboarding')}
              className="bg-gradient-to-r from-blue-600 to-purple-600 text-white px-8 py-4 rounded-lg text-lg font-semibold hover:shadow-xl transform hover:-translate-y-1 transition-all flex items-center gap-2"
            >
              Start Protecting Now
              <ArrowRight className="w-5 h-5" />
            </button>
            <button className="border-2 border-gray-300 px-8 py-4 rounded-lg text-lg font-semibold hover:border-blue-600 hover:text-blue-600 transition-all">
              See Demo
            </button>
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-8 mb-16">
          <div className="bg-white p-6 rounded-xl shadow-lg border-t-4 border-blue-500">
            <Clock className="w-12 h-12 text-blue-600 mb-4" />
            <h3 className="text-xl font-bold mb-2">Instant Timestamping</h3>
            <p className="text-gray-600">
              Register your work on the blockchain in seconds. Immutable proof of when you created it.
            </p>
          </div>
          <div className="bg-white p-6 rounded-xl shadow-lg border-t-4 border-purple-500">
            <Shield className="w-12 h-12 text-purple-600 mb-4" />
            <h3 className="text-xl font-bold mb-2">Legal Protection</h3>
            <p className="text-gray-600">
              Generate court-ready certificates. Prove you were first in line, first in time.
            </p>
          </div>
          <div className="bg-white p-6 rounded-xl shadow-lg border-t-4 border-green-500">
            <Users className="w-12 h-12 text-green-600 mb-4" />
            <h3 className="text-xl font-bold mb-2">Collaboration Proof</h3>
            <p className="text-gray-600">
              Add witnesses to verify creation dates. Perfect for team projects and disputes.
            </p>
          </div>
        </div>

        <div className="bg-gradient-to-r from-blue-50 to-purple-50 p-8 rounded-xl">
          <h2 className="text-3xl font-bold text-center mb-8">1000x Cheaper Than Traditional Copyright</h2>
          <div className="grid md:grid-cols-4 gap-4">
            <div className="bg-white p-6 rounded-lg shadow">
              <div className="text-gray-500 text-sm mb-2">Free Tier</div>
              <div className="text-3xl font-bold mb-2">$0</div>
              <div className="text-sm text-gray-600">5 registrations/month</div>
            </div>
            <div className="bg-white p-6 rounded-lg shadow border-2 border-blue-500">
              <div className="text-blue-600 text-sm mb-2 font-semibold">Most Popular</div>
              <div className="text-3xl font-bold mb-2">$10<span className="text-lg">/mo</span></div>
              <div className="text-sm text-gray-600">50 registrations/month</div>
            </div>
            <div className="bg-white p-6 rounded-lg shadow">
              <div className="text-gray-500 text-sm mb-2">Professional</div>
              <div className="text-3xl font-bold mb-2">$25<span className="text-lg">/mo</span></div>
              <div className="text-sm text-gray-600">Unlimited + API access</div>
            </div>
            <div className="bg-white p-6 rounded-lg shadow">
              <div className="text-gray-500 text-sm mb-2">Studio</div>
              <div className="text-3xl font-bold mb-2">$100<span className="text-lg">/mo</span></div>
              <div className="text-sm text-gray-600">Team accounts</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const TimelineScreen = () => (
    <div className="min-h-screen bg-gray-50">
      <Navigation minimal={true} />
      
      <div className="max-w-4xl mx-auto px-4 py-12">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Summer Album 2024</h1>
          <p className="text-gray-600">Music Project • Created Oct 15, 2024</p>
        </div>

        <div className="bg-white rounded-xl shadow-lg p-8">
          <div className="space-y-8">
            <div className="flex gap-6">
              <div className="flex flex-col items-center">
                <div className="w-12 h-12 bg-green-500 rounded-full flex items-center justify-center text-white font-bold">
                  <CheckCircle className="w-6 h-6" />
                </div>
                <div className="w-1 flex-1 bg-green-500 mt-2"></div>
              </div>
              <div className="flex-1 pb-8">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <h3 className="text-xl font-bold">Track 3 Final Mix</h3>
                    <p className="text-sm text-gray-500">Nov 1, 2024 • 2:34 PM</p>
                  </div>
                  <span className="bg-green-100 text-green-700 px-3 py-1 rounded-full text-sm font-semibold">Final</span>
                </div>
                <p className="text-gray-600 mb-3">Completed final mixing and mastering</p>
                <div className="bg-gray-50 p-3 rounded-lg font-mono text-xs break-all text-gray-500">
                  Hash: 0x8f7d...a2b3
                </div>
              </div>
            </div>

            <div className="flex gap-6">
              <div className="flex flex-col items-center">
                <div className="w-12 h-12 bg-blue-500 rounded-full flex items-center justify-center text-white font-bold">
                  <Clock className="w-6 h-6" />
                </div>
                <div className="w-1 flex-1 bg-blue-500 mt-2"></div>
              </div>
              <div className="flex-1 pb-8">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <h3 className="text-xl font-bold">Track 3 Revision 2</h3>
                    <p className="text-sm text-gray-500">Oct 28, 2024 • 4:12 PM</p>
                  </div>
                  <span className="bg-blue-100 text-blue-700 px-3 py-1 rounded-full text-sm font-semibold">Revision</span>
                </div>
                <p className="text-gray-600 mb-3">Added backing vocals and adjusted EQ</p>
                <div className="bg-gray-50 p-3 rounded-lg font-mono text-xs break-all text-gray-500 mb-3">
                  Hash: 0x3e9c...f1d4
                </div>
                <div className="flex gap-2">
                  <div className="flex items-center gap-1 text-sm text-gray-600">
                    <Users className="w-4 h-4" />
                    2 witnesses
                  </div>
                </div>
              </div>
            </div>

            <div className="flex gap-6">
              <div className="flex flex-col items-center">
                <div className="w-12 h-12 bg-purple-500 rounded-full flex items-center justify-center text-white font-bold">
                  <FileText className="w-6 h-6" />
                </div>
              </div>
              <div className="flex-1">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <h3 className="text-xl font-bold">Track 3 First Draft</h3>
                    <p className="text-sm text-gray-500">Oct 20, 2024 • 11:23 AM</p>
                  </div>
                  <span className="bg-purple-100 text-purple-700 px-3 py-1 rounded-full text-sm font-semibold">Draft</span>
                </div>
                <p className="text-gray-600 mb-3">Initial recording and composition</p>
                <div className="bg-gray-50 p-3 rounded-lg font-mono text-xs break-all text-gray-500">
                  Hash: 0x1a2b...c4d5
                </div>
              </div>
            </div>
          </div>

          <button 
            onClick={() => setCurrentScreen('register')}
            className="mt-8 w-full bg-gradient-to-r from-blue-600 to-purple-600 text-white px-6 py-3 rounded-lg font-semibold hover:shadow-lg flex items-center justify-center gap-2"
          >
            <Plus className="w-5 h-5" />
            Add New Milestone
          </button>
        </div>
      </div>
    </div>
  );

  const VerifyScreen = () => (
    <div className="min-h-screen bg-gray-50">
      <Navigation minimal={true} />
      
      <div className="max-w-3xl mx-auto px-4 py-12">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold mb-2">Verify Content</h1>
          <p className="text-gray-600">Check if content has been registered on the blockchain</p>
        </div>

        <div className="bg-white rounded-xl shadow-lg p-8 mb-8">
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-semibold mb-2">Upload File or Enter Hash</label>
              <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-blue-500 cursor-pointer mb-4">
                <Upload className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <div className="font-semibold mb-1">Drop file here to verify</div>
                <div className="text-sm text-gray-500">We will generate the hash locally</div>
              </div>
              
              <div className="text-center text-gray-500 mb-4">OR</div>
              
              <input 
                type="text" 
                placeholder="Enter content hash (0x...)"
                className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-blue-500 focus:outline-none font-mono text-sm"
              />
            </div>

            <button className="w-full bg-gradient-to-r from-blue-600 to-purple-600 text-white px-6 py-3 rounded-lg font-semibold hover:shadow-lg flex items-center justify-center gap-2">
              <Search className="w-5 h-5" />
              Verify Content
            </button>
          </div>
        </div>

        <div className="bg-green-50 border-2 border-green-200 rounded-xl p-8">
          <div className="flex items-start gap-4 mb-6">
            <div className="w-12 h-12 bg-green-500 rounded-full flex items-center justify-center flex-shrink-0">
              <CheckCircle className="w-6 h-6 text-white" />
            </div>
            <div className="flex-1">
              <h3 className="text-2xl font-bold text-green-900 mb-2">Content Verified!</h3>
              <p className="text-green-700">This content was registered on the blockchain</p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="bg-white p-4 rounded-lg">
              <div className="text-sm text-gray-600 mb-1">Registration Date</div>
              <div className="font-semibold">October 20, 2024 at 11:23 AM</div>
            </div>

            <div className="bg-white p-4 rounded-lg">
              <div className="text-sm text-gray-600 mb-1">Creator</div>
              <div className="font-mono text-sm">0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb</div>
            </div>

            <div className="bg-white p-4 rounded-lg">
              <div className="text-sm text-gray-600 mb-1">Project</div>
              <div className="font-semibold">Summer Album 2024</div>
              <div className="text-sm text-gray-500">Music • Track 3 First Draft</div>
            </div>

            <div className="bg-white p-4 rounded-lg">
              <div className="text-sm text-gray-600 mb-1">Blockchain Transaction</div>
              <div className="font-mono text-xs break-all text-blue-600">
                0x8f7d3e2a1b9c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e
              </div>
            </div>

            <button className="w-full border-2 border-green-600 text-green-600 px-6 py-3 rounded-lg font-semibold hover:bg-green-50">
              Download Certificate
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-white">
      <ScreenSelector />
      
      {currentScreen === 'landing' && <LandingScreen />}
      {currentScreen === 'onboarding' && (
        <div className="min-h-screen bg-gray-50">
          <Navigation minimal={true} />
          <div className="max-w-2xl mx-auto px-4 py-12">
            <div className="bg-white rounded-xl shadow-lg p-8">
              <div className="text-center mb-8">
                <Shield className="w-16 h-16 text-blue-600 mx-auto mb-4" />
                <h2 className="text-3xl font-bold mb-2">Welcome to ProofStream</h2>
                <p className="text-gray-600">Connect your wallet to get started</p>
              </div>

              <div className="space-y-4">
                <div className="border-2 border-gray-200 rounded-lg p-4 hover:border-blue-500 cursor-pointer transition-all">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 bg-orange-100 rounded-lg flex items-center justify-center">
                        <Wallet className="w-6 h-6 text-orange-600" />
                      </div>
                      <div>
                        <div className="font-semibold">MetaMask</div>
                        <div className="text-sm text-gray-500">Most popular wallet</div>
                      </div>
                    </div>
                    <ArrowRight className="w-5 h-5 text-gray-400" />
                  </div>
                </div>

                <div className="border-2 border-gray-200 rounded-lg p-4 hover:border-blue-500 cursor-pointer transition-all">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                        <Wallet className="w-6 h-6 text-blue-600" />
                      </div>
                      <div>
                        <div className="font-semibold">WalletConnect</div>
                        <div className="text-sm text-gray-500">Connect any wallet</div>
                      </div>
                    </div>
                    <ArrowRight className="w-5 h-5 text-gray-400" />
                  </div>
                </div>
              </div>

              <button 
                onClick={() => setCurrentScreen('dashboard')}
                className="w-full mt-8 bg-gradient-to-r from-blue-600 to-purple-600 text-white py-3 rounded-lg font-semibold hover:shadow-lg transition-all"
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      )}
      {currentScreen === 'dashboard' && (
        <div className="min-h-screen bg-gray-50">
          <Navigation minimal={true} />
          <div className="max-w-7xl mx-auto px-4 py-12">
            <div className="mb-8">
              <h1 className="text-3xl font-bold mb-2">Dashboard</h1>
              <p className="text-gray-600">Welcome back! Protect your creative work.</p>
            </div>

            <div className="grid md:grid-cols-2 gap-6">
              <button 
                onClick={() => setCurrentScreen('create-project')}
                className="bg-gradient-to-r from-blue-600 to-purple-600 text-white p-8 rounded-xl text-left hover:shadow-xl transition-all"
              >
                <Plus className="w-12 h-12 mb-4" />
                <h3 className="text-2xl font-bold mb-2">Create New Project</h3>
                <p className="text-blue-100">Start tracking a creative timeline</p>
              </button>

              <button 
                onClick={() => setCurrentScreen('verify')}
                className="bg-white border-2 border-gray-200 p-8 rounded-xl text-left hover:border-blue-500 hover:shadow-lg transition-all"
              >
                <Search className="w-12 h-12 mb-4 text-gray-400" />
                <h3 className="text-2xl font-bold mb-2">Verify Content</h3>
                <p className="text-gray-600">Check if content is registered</p>
              </button>
            </div>
          </div>
        </div>
      )}
      {currentScreen === 'create-project' && (
        <div className="min-h-screen bg-gray-50">
          <Navigation minimal={true} />
          <div className="max-w-3xl mx-auto px-4 py-12">
            <h1 className="text-3xl font-bold mb-8">Create New Project</h1>
            <div className="bg-white rounded-xl shadow-lg p-8">
              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-semibold mb-2">Project Name</label>
                  <input type="text" placeholder="My Creative Project" className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg" />
                </div>
                <button 
                  onClick={() => setCurrentScreen('timeline')}
                  className="w-full bg-gradient-to-r from-blue-600 to-purple-600 text-white px-6 py-3 rounded-lg font-semibold"
                >
                  Create Project
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {currentScreen === 'register' && (
        <div className="min-h-screen bg-gray-50">
          <Navigation minimal={true} />
          <div className="max-w-3xl mx-auto px-4 py-12">
            <h1 className="text-3xl font-bold mb-8">Register Milestone</h1>
            <div className="bg-white rounded-xl shadow-lg p-8">
              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-semibold mb-2">Upload File</label>
                  <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
                    <Upload className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                    <p>Drop file here or click to upload</p>
                  </div>
                </div>
                <button 
                  onClick={() => setCurrentScreen('timeline')}
                  className="w-full bg-gradient-to-r from-blue-600 to-purple-600 text-white px-6 py-3 rounded-lg font-semibold"
                >
                  Register Milestone
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {currentScreen === 'timeline' && <TimelineScreen />}
      {currentScreen === 'verify' && <VerifyScreen />}
    </div>
  );
};

export default ProofStreamWireframes;