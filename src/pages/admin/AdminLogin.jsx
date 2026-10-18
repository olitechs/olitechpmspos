import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ShieldCheck, Mail, Lock, Loader2 } from 'lucide-react';
import AuthLayout from '@/components/ui/AuthLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/lib/AuthContext';

export default function AdminLogin() {
	const { login, user } = useAuth();
	const navigate = useNavigate();
	const [email, setEmail] = useState('');
	const [password, setPassword] = useState('');
	const [error, setError] = useState('');
	const [loading, setLoading] = useState(false);

	// Already signed in as the owner — skip straight to the console.
	if (user?.isPlatformOwner) {
		return <Navigate to="/admin" replace />;
	}

	const handleSubmit = async (e) => {
		e.preventDefault();
		setError('');
		setLoading(true);
		try {
			const loggedInUser = await login(email, password, { navigate: false });
			if (!loggedInUser?.isPlatformOwner) {
				setError('This account does not have platform owner access. Use the property sign-in page instead.');
			} else {
				navigate('/admin', { replace: true });
			}
		} catch (err) {
			setError(err.message || 'Sign in failed.');
		} finally {
			setLoading(false);
		}
	};

	return (
		<AuthLayout icon={ShieldCheck} title="OliTechs Admin" subtitle="Platform owner sign in">
			{error && <div className="mb-4 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">{error}</div>}
			<form onSubmit={handleSubmit} className="space-y-4">
				<div className="space-y-2">
					<Label htmlFor="email">Email</Label>
					<div className="relative">
						<Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
						<Input id="email" type="email" autoComplete="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} className="pl-10 h-12" required />
					</div>
				</div>
				<div className="space-y-2">
					<Label htmlFor="password">Password</Label>
					<div className="relative">
						<Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
						<Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className="pl-10 h-12" required />
					</div>
				</div>
				<Button type="submit" className="w-full h-12 font-medium" disabled={loading}>
					{loading ? (
						<>
							<Loader2 className="w-4 h-4 mr-2 animate-spin" /> Signing in...
						</>
					) : (
						'Sign in to Admin'
					)}
				</Button>
			</form>
		</AuthLayout>
	);
}
