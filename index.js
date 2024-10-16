import express from 'express';
import { createClient } from 'redis';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// Configure Redis client
const client = createClient({
	url: process.env.REDIS_URL || 'redis://localhost:6379',
});

async function connectRedis() {
	try {
		await client.connect();
		console.log('Connected to Redis...');
	} catch (err) {
		console.error('Redis connection error:', err);
		setTimeout(connectRedis, 5000); // Retry connection every 5 seconds
	}
}

await connectRedis();

// Redis event handlers
client.on('error', (err) => {
	console.error('Redis Client Error', err);
});

client.on('end', () => {
	console.log('Redis client disconnected');
	connectRedis(); // Reconnect on disconnect
});

// Graceful shutdown
process.on('SIGINT', async () => {
	console.log('Shutting down gracefully...');
	await client.quit();
	process.exit(0);
});

// Middleware for customizable rate limits
const rateLimiter = (timeWindow, maxRequests) => async (req, res, next) => {
	try {
		if (!client.isOpen) {
			return res.status(500).json({ message: 'Redis connection error' });
		}

		// Dynamic rate limits per user or route
		const userIP = req.ip;
		const redisKey = `${userIP}:${req.route.path}`; // Differentiates per route
		const currentRequests = await client.get(redisKey);
		const requestCount = currentRequests ? parseInt(currentRequests) : 0;

		if (requestCount >= maxRequests) {
			const retryAfter = await client.ttl(redisKey);

			res.set('X-RateLimit-Limit', maxRequests);
			res.set('X-RateLimit-Remaining', 0);
			res.set('X-RateLimit-Reset', retryAfter);
			return res.status(429).json({
				message: 'Too many requests. Please try again later.',
				'Retry-After': retryAfter,
			});
		} else {
			// Increment and set expiry if it's a new key
			await client
				.multi()
				.incr(redisKey)
				.expire(redisKey, timeWindow)
				.exec();

			// Add headers to the response
			res.set('X-RateLimit-Limit', maxRequests);
			res.set('X-RateLimit-Remaining', maxRequests - (requestCount + 1));
			res.set('X-RateLimit-Reset', timeWindow);

			next();
		}
	} catch (error) {
		console.error('Error in rateLimiter:', error);
		res.status(500).json({ message: 'Internal server error' });
	}
};

// Example route with dynamic rate limiting
app.get('/', rateLimiter(60, 5), (req, res) => {
	res.send('Welcome! Your request is within limit.');
});

// Example route with a higher rate limit
app.get('/premium', rateLimiter(60, 10), (req, res) => {
	res.send('Welcome premium user! You have more request allowance.');
});

// Whitelist middleware to bypass rate limiting for specific IPs
const whitelistIPs = ['127.0.0.1', '::1'];

const whitelistRateLimiter =
	(timeWindow, maxRequests) => async (req, res, next) => {
		if (whitelistIPs.includes(req.ip)) {
			return next(); // Bypass rate limit for whitelisted IPs
		}
		return rateLimiter(timeWindow, maxRequests)(req, res, next);
	};

// Route using the whitelisted rate limiter
app.get('/whitelisted', whitelistRateLimiter(60, 5), (req, res) => {
	res.send('Whitelisted IPs can bypass rate limits.');
});

// Start server
app.listen(port, () => {
	console.log(`Server running on http://localhost:${port}`);
});
