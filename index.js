import express from 'express';
import { createClient } from 'redis';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

const client = createClient({ url: 'redis://localhost:6379' });

// Redis connection management with retries
async function connectRedis() {
	try {
		await client.connect();
		console.log('Connected to Redis...');
	} catch (err) {
		console.error('Redis connection error:', err);
		setTimeout(connectRedis, 5000); // Retry after 5 seconds
	}
}

await connectRedis();

client.on('error', (err) => {
	console.error('Redis Client Error', err);
});

client.on('ready', () => {
	console.log('Redis client connected and ready!');
});

client.on('end', () => {
	console.log('Redis client disconnected');
	connectRedis(); // Reconnect on disconnect
});

// Middleware for rate limiting
const rateLimiter = async (req, res, next) => {
	try {
		if (!client.isOpen) {
			console.error('Redis client is not connected');
			return res.status(500).json({ message: 'Redis connection error' });
		}

		const userIP = req.ip;
		const timeWindow = process.env.TIME_WINDOW || 60; // time window in seconds
		const maxRequests = process.env.MAX_REQUESTS || 5;

		// Fetch current request count from Redis
		const currentRequestCount = await client.get(userIP);
		const requestCount = currentRequestCount
			? parseInt(currentRequestCount)
			: 0;

		if (requestCount >= maxRequests) {
			const retryAfter = await client.ttl(userIP); // Get time until the key expires

			// Add rate limit headers
			res.set('X-RateLimit-Limit', maxRequests);
			res.set('X-RateLimit-Remaining', 0);
			res.set('X-RateLimit-Reset', retryAfter);

			// Send 429 response with Retry-After header
			return res.status(429).json({
				message: 'Too many requests. Please try again later.',
				'Retry-After': retryAfter,
			});
		} else {
			// Increment request count and reset TTL
			await client.setEx(
				userIP,
				timeWindow,
				(requestCount + 1).toString()
			);

			// Add rate limit headers
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

// Global error handler
app.use((err, req, res, next) => {
	console.error('Global error handler:', err);
	res.status(500).json({ message: 'Internal server error' });
});

// Sample route with rate limiter
app.get('/', rateLimiter, (req, res) => {
	res.send('Welcome, your request is within limit!');
});

// Listen for requests
app.listen(port, () => {
	console.log(`Server running on http://localhost:${port}`);
});
